import { Player } from '../common';
import { IncomingMsg, OutgoingMsg } from '../server';
import { GameServer, GameClient } from './game';
import { UserInput } from '../client/user-input';
import { Button, TextInput } from '../client/ui-elements';

const HINT_INTERVAL_SECONDS = 20;
const MAX_HINT_STAGE = 3;

type GuessSongServerMsg = {
    kind: 'guess_song_update';
    gameState: GameState;
    lastGuess?: GuessHistoryEntry;
};

type GuessSongClientMsg =
    | {
        kind: 'guess_song_option';
        mode: 'genre' | 'artist';
        value: string;
        rounds: number;
    }
    | {
        kind: 'guess_song_submit';
        guess: string;
    }
    | {
        kind: 'guess_song_next_round';
    }
    | {
        kind: 'guess_song_skip';
    };

type GuessHistoryEntry = {
    playerName: string;
    guess: string;
    result: 'wrong' | 'correct';
    timestamp: number;
};

type GameState = {
    phase: 'selection' | 'loading' | 'playing' | 'round_over' | 'game_over';
    mode: 'genre' | 'artist' | null;
    selectedValue: string | null;
    previewUrl: string | null;
    trackNameMask: string | null;
    artistHint: string | null;
    genreHint: string | null;
    albumHint: string | null;
    hintIntervalSeconds: number;
    hintStage: number;
    startedAt: number | null;
    guesses: GuessHistoryEntry[];
    gameOver: boolean;
    totalRounds: number;
    currentRound: number;
    scores: Record<string, number>;
    skipVotes: Record<string, boolean>;
    skipsThisRound: number;
    winnerId?: string;
    roundWinner?: string | null;
    errorMessage?: string;
    actualTrackName?: string | null;
    actualArtistName?: string | null;
};

type TrackResult = {
    trackId?: number;
    trackName: string;
    artistName: string;
    previewUrl: string;
    collectionName: string;
    genre: string;
    releaseYear?: number;
};

function normalizeText(text: string): string {
    return text
        .normalize('NFD')
        .replace(/\p{Diacritic}/gu, '')
        .replace(/[^a-z0-9]+/gi, '')
        .toLowerCase();
}

function buildTrackMask(trackName: string, stage: number): string {
    return trackName.replace(/[A-Za-zÀ-ÿ]/g, (char, index) => {
        if (stage >= 3) return char;
        const isFirstLetter = index === 0 || /[\s\-\(\[\{\"'“‘]/.test(trackName[index - 1]);
        if (stage === 0) return '_';
        if (stage === 1) return isFirstLetter ? char : '_';
        if (stage === 2) {
            if (isFirstLetter) return char;
            const previousChar = trackName[index - 1];
            if (/[A-Za-zÀ-ÿ]/.test(previousChar) && /[\s\-\(\[\{\"'“‘]/.test(trackName[index - 2] || ' ')) {
                return char;
            }
            return '_';
        }
        return char;
    });
}

function fetchItunesSearch(term: string, offset: number = 0): Promise<any> {
    const encoded = encodeURIComponent(term);
    const url = `https://itunes.apple.com/search?term=${encoded}&media=music&entity=song&limit=30&offset=${offset}&country=IT`;
    const fetchFn = (globalThis as any).fetch;

    if (!fetchFn) {
        return Promise.reject(new Error('Fetch non disponibile sul server')); 
    }

    return fetchFn(url).then((response: any) => response.json());
}

type YearRange = {
    min: number;
    max: number;
};

function chooseTrack(results: any[], usedTrackKeys: Set<string>, yearRange: YearRange | null = null): TrackResult | null {
    const mappedTracks = results
        .filter((item) => item.previewUrl && item.trackName && item.artistName)
        .map((item) => {
            const trackId = typeof item.trackId === 'number' ? item.trackId : null;
            const releaseYear = item.releaseDate ? new Date(item.releaseDate).getFullYear() : null;
            const trackKey = trackId !== null
                ? `id:${trackId}`
                : `track:${normalizeText(`${item.trackName}|${item.artistName}`)}`;

            return {
                trackId,
                trackKey,
                trackName: item.trackName,
                artistName: item.artistName,
                previewUrl: item.previewUrl,
                collectionName: item.collectionName || 'Unknown album',
                genre: item.primaryGenreName || 'Unknown genre',
                releaseYear,
            };
        });

    const filterCandidates = (excludeUsed: boolean, yearRange: YearRange | null) => {
        return mappedTracks.filter((item) => {
            if (excludeUsed && usedTrackKeys.has(item.trackKey)) return false;
            if (yearRange !== null) {
                return item.releaseYear !== null && item.releaseYear >= yearRange.min && item.releaseYear <= yearRange.max;
            }
            return true;
        });
    };

    const hasAnyReleaseYear = mappedTracks.some((item) => item.releaseYear !== null);
    let candidates = filterCandidates(true, yearRange);
    if (candidates.length === 0 && !hasAnyReleaseYear) {
        candidates = filterCandidates(true, null);
    }
    if (candidates.length === 0) {
        candidates = filterCandidates(false, yearRange);
    }
    if (candidates.length === 0 && !hasAnyReleaseYear) {
        candidates = filterCandidates(false, null);
    }
    if (candidates.length === 0) return null;

    const index = Math.floor(Math.random() * candidates.length);
    const chosen = candidates[index];
    usedTrackKeys.add(chosen.trackKey);
    return {
        trackId: chosen.trackId,
        trackName: chosen.trackName,
        artistName: chosen.artistName,
        previewUrl: chosen.previewUrl,
        collectionName: chosen.collectionName,
        genre: chosen.genre,
        releaseYear: chosen.releaseYear,
    };
}

export class GuessSongServer extends GameServer {
    private gameState: GameState;
    private gamePlayers: Record<string, Player>;
    private initMessage: GuessSongServerMsg | null;
    private searchPromise: Promise<void> | null = null;
    private internalTrackName: string = '';
    private pendingBroadcast: boolean = false;
    private playedTrackKeys: Set<string>;

    constructor() {
        super();
        this.playedTrackKeys = new Set<string>();
        this.gameState = {
            phase: 'selection',
            mode: null,
            selectedValue: null,
            previewUrl: null,
            trackNameMask: null,
            artistHint: null,
            genreHint: null,
            albumHint: null,
            hintIntervalSeconds: HINT_INTERVAL_SECONDS,
            hintStage: 0,
            startedAt: null,
            guesses: [],
            gameOver: false,
            totalRounds: 1,
            currentRound: 0,
            scores: {},
            skipVotes: {},
            skipsThisRound: 0,
            actualTrackName: null,
            actualArtistName: null,
        };
        this.initMessage = null;
    }

    init(players: Record<string, Player>) {
        this.gamePlayers = players;
        this.playedTrackKeys.clear();
        this.initMessage = {
            kind: 'guess_song_update',
            gameState: this.gameState,
        };
    }

    tick(incomingMessages: IncomingMsg[], dt: number): OutgoingMsg[] {
        const outgoingMessages: OutgoingMsg[] = [];

        if (this.initMessage) {
            outgoingMessages.push({ payload: this.initMessage });
            this.initMessage = null;
        }

        if (this.gameState.phase === 'playing' && this.gameState.startedAt) {
            const elapsed = (Date.now() - this.gameState.startedAt) / 1000;
            const newStage = Math.min(Math.floor(elapsed / this.gameState.hintIntervalSeconds), MAX_HINT_STAGE);
            if (newStage !== this.gameState.hintStage) {
                this.gameState.hintStage = newStage;
                this.gameState.trackNameMask = buildTrackMask(this.internalTrackName, this.gameState.hintStage);
                this.pendingBroadcast = true;
            }
        }

        if (this.pendingBroadcast) {
            outgoingMessages.push({ payload: { kind: 'guess_song_update', gameState: this.gameState } });
            this.pendingBroadcast = false;
        }

        incomingMessages.forEach((message) => {
            const clientId = message.clientId;
            const payload = message.payload as GuessSongClientMsg;

            if (payload.kind === 'guess_song_option' && this.gameState.phase === 'selection') {
                this.handleSongOption(clientId, payload.mode, payload.value, payload.rounds);
            }
            else if (payload.kind === 'guess_song_skip' && this.gameState.phase === 'playing' && !this.gameState.gameOver) {
                if (!(clientId in this.gamePlayers)) return;
                this.gameState.skipVotes[clientId] = true;

                Object.keys(this.gameState.skipVotes).forEach((id) => {
                    if (!(id in this.gamePlayers)) {
                        delete this.gameState.skipVotes[id];
                    }
                });

                const skipCount = Object.keys(this.gameState.skipVotes).length;
                const totalPlayers = Object.keys(this.gamePlayers).length;
                const skipThreshold = Math.min(4, totalPlayers);
                if (this.gameState.skipsThisRound >= 4) {
                    this.pendingBroadcast = true;
                    return;
                }
                if (skipCount >= skipThreshold) {
                    this.restartCurrentRound();
                } else {
                    this.pendingBroadcast = true;
                }
            }
            else if (payload.kind === 'guess_song_next_round' && this.gameState.phase === 'round_over') {
                this.startNextRound();
            }
            else if (payload.kind === 'guess_song_submit' && this.gameState.phase === 'playing' && !this.gameState.gameOver) {
                const player = this.gamePlayers[clientId];
                const guessResult = normalizeText(payload.guess);
                const actual = normalizeText(this.internalTrackName);
                const isCorrect = guessResult === actual;

                const entry: GuessHistoryEntry = {
                    playerName: player.name,
                    guess: payload.guess,
                    result: isCorrect ? 'correct' : 'wrong',
                    timestamp: Date.now(),
                };
                this.gameState.guesses.push(entry);

                if (isCorrect) {
                    this.gameState.scores[clientId] = (this.gameState.scores[clientId] || 0) + 1;
                    this.gameState.winnerId = clientId;
                    this.gameState.roundWinner = player.name;
                    this.gameState.actualTrackName = this.internalTrackName;
                    this.gameState.actualArtistName = this.gameState.artistHint || null;
                    if (this.gameState.currentRound >= this.gameState.totalRounds) {
                        this.gameState.gameOver = true;
                        this.gameState.phase = 'game_over';
                    } else {
                        this.gameState.phase = 'round_over';
                    }
                }

                outgoingMessages.push({
                    payload: {
                        kind: 'guess_song_update',
                        gameState: this.gameState,
                        lastGuess: entry,
                    },
                });
            }
        });

        return outgoingMessages;
    }

    private handleSongOption(clientId: string, mode: 'genre' | 'artist', value: string, rounds: number) {
        const trimmedValue = value.trim();
        if (!trimmedValue) {
            this.gameState.errorMessage = 'Inserisci un artista o scegli un genere valido.';
            this.pendingBroadcast = true;
            return;
        }

        this.gameState.phase = 'loading';
        this.gameState.mode = mode;
        this.gameState.selectedValue = trimmedValue;
        this.gameState.errorMessage = undefined;
        this.gameState.previewUrl = null;
        this.gameState.totalRounds = Math.max(1, rounds);
        this.gameState.currentRound = 1;
        this.gameState.scores = {};
        Object.keys(this.gamePlayers).forEach(id => this.gameState.scores[id] = 0);
        this.gameState.roundWinner = null;
        this.gameState.skipVotes = {};
        this.gameState.skipsThisRound = 0;
        this.playedTrackKeys.clear();
        this.pendingBroadcast = true;

        const yearRange = this.getSearchYearRange();
        const randomOffset = Math.floor(Math.random() * 60);
        this.searchPromise = fetchItunesSearch(this.gameState.mode === 'genre' ? `${this.gameState.selectedValue} song` : this.gameState.selectedValue, randomOffset)
            .then((result: any) => {
                const track = chooseTrack(result.results || [], this.playedTrackKeys, yearRange);
                if (!track) {
                    this.gameState.phase = 'selection';
                    this.gameState.errorMessage = 'Nessun brano trovato. Prova un genere o un artista diverso.';
                    this.pendingBroadcast = true;
                    return;
                }

                this.internalTrackName = track.trackName;
                this.gameState.previewUrl = track.previewUrl;
                this.gameState.artistHint = track.artistName;
                this.gameState.genreHint = track.genre;
                this.gameState.albumHint = track.collectionName;
                this.gameState.trackNameMask = buildTrackMask(track.trackName, 0);
                this.gameState.hintStage = 0;
                this.gameState.startedAt = Date.now();
                this.gameState.phase = 'playing';
                this.gameState.guesses = [];
                this.gameState.gameOver = false;
                this.gameState.winnerId = undefined;
                this.gameState.actualTrackName = null;
                this.gameState.actualArtistName = null;
                this.pendingBroadcast = true;
            })
            .catch(() => {
                this.gameState.phase = 'selection';
                this.gameState.errorMessage = 'Errore nella ricerca su iTunes. Riprova.';
                this.pendingBroadcast = true;
            });
    }

    private startNextRound() {
        if (!this.gameState.mode || !this.gameState.selectedValue) return;
        if (this.gameState.currentRound >= this.gameState.totalRounds) return;

        this.gameState.currentRound += 1;
        this.gameState.skipsThisRound = 0;
        this.loadSongForCurrentRound('Nessun brano trovato per il round successivo.', 'Errore nella ricerca del round successivo.');
    }

    private restartCurrentRound() {
        if (!this.gameState.mode || !this.gameState.selectedValue) return;

        this.gameState.skipsThisRound += 1;
        this.loadSongForCurrentRound('Nessun brano trovato per lo skip.', 'Errore nella ricerca dopo lo skip.');
    }

    private loadSongForCurrentRound(notFoundMessage: string, errorMessage: string) {
        this.gameState.phase = 'loading';
        this.gameState.errorMessage = undefined;
        this.gameState.previewUrl = null;
        this.gameState.roundWinner = null;
        this.gameState.winnerId = undefined;
        this.gameState.actualTrackName = null;
        this.gameState.actualArtistName = null;
        this.gameState.guesses = [];
        this.gameState.gameOver = false;
        this.gameState.skipVotes = {};
        this.pendingBroadcast = true;

        const yearRange = this.getSearchYearRange();
        const randomOffset = Math.floor(Math.random() * 60);
        this.searchPromise = fetchItunesSearch(this.gameState.mode === 'genre'
            ? `${this.gameState.selectedValue} song`
            : this.gameState.selectedValue,
            randomOffset)
            .then((result: any) => {
                const track = chooseTrack(result.results || [], this.playedTrackKeys, yearRange);
                if (!track) {
                    this.gameState.phase = 'round_over';
                    this.gameState.roundWinner = null;
                    this.gameState.winnerId = undefined;
                    this.gameState.errorMessage = notFoundMessage;
                    this.pendingBroadcast = true;
                    return;
                }

                this.internalTrackName = track.trackName;
                this.gameState.previewUrl = track.previewUrl;
                this.gameState.artistHint = track.artistName;
                this.gameState.genreHint = track.genre;
                this.gameState.albumHint = track.collectionName;
                this.gameState.trackNameMask = buildTrackMask(track.trackName, 0);
                this.gameState.hintStage = 0;
                this.gameState.startedAt = Date.now();
                this.gameState.phase = 'playing';
                this.gameState.guesses = [];
                this.gameState.gameOver = false;
                this.gameState.winnerId = undefined;
                this.gameState.actualTrackName = null;
                this.gameState.actualArtistName = null;
                this.pendingBroadcast = true;
            })
            .catch(() => {
                this.gameState.phase = 'round_over';
                this.gameState.roundWinner = null;
                this.gameState.winnerId = undefined;
                this.gameState.actualTrackName = null;
                this.gameState.actualArtistName = null;
                this.gameState.errorMessage = errorMessage;
                this.pendingBroadcast = true;
            });
    }

    private getSearchYearRange(): YearRange | null {
        if (!this.gameState.selectedValue) return null;
        const match = this.gameState.selectedValue.match(/anni\s+(\d{2,4})/i);
        if (!match) return null;

        const year = Number(match[1]);
        if (Number.isNaN(year)) return null;

        // decades: anni 50 => 1950-1959, anni 2000 => 2000-2009, anni 2010 => 2010-2019, etc.
        const prefix = match[1].length === 2 ? year : year;
        const min = prefix < 100 ? 1900 + prefix : prefix;
        const max = min + 9;

        return { min, max };
    }

    isFinished(): boolean {
        return this.gameState.gameOver;
    }
}

export class GuessSongClient extends GameClient {
    private gameState: GameState | null = null;
    private players: Record<string, Player>;
    private currentGuess: string = '';
    private messageQueue: GuessSongClientMsg[] = [];
    private userExited: boolean = false;
    private exitButton: Button;
    private startButton: Button;
    private genreButtons: Array<{ button: Button; genre: string }> = [];
    private modeButtons: Array<{ button: Button; mode: 'genre' | 'artist' }> = [];
    private artistInput: TextInput;
    private selectedMode: 'genre' | 'artist' = 'genre';
    private selectedGenre: string = 'Pop';
    private selectedItalianEra: string | null = null;
    private selectedRounds: number = 3;
    private roundButtons: Array<{ button: Button; count: number }> = [];
    private italianEraButtons: Array<{ button: Button; era: string }> = [];
    private skipButton: Button;
    private nextRoundButton: Button;
    private audio: HTMLAudioElement | null = null;
    private lastGuessResult: GuessHistoryEntry | null = null;
    private errorMessage: string | null = null;

    private readonly genres = ['Pop', 'Rock', 'Rap', 'Electronic', 'Jazz', 'Country'];
    private readonly italianEras = ['anni 70', 'anni 80', 'anni 90', 'anni 2000', 'anni 2010', 'anni 2020'];
    private readonly roundOptions = [1, 3, 5];

    constructor(userInput: UserInput, myId: string) {
        super(userInput, myId);

        this.artistInput = new TextInput(this.userInput, 'Inserisci artista', 30);

        this.exitButton = new Button('Esci', this.userInput, () => {
            this.userExited = true;
            if (this.audio) {
                this.audio.pause();
                this.audio = null;
            }
        });

        this.startButton = new Button('Avvia', this.userInput, () => {
            this.sendSelection();
        });

        this.nextRoundButton = new Button('Prossimo round', this.userInput, () => {
            this.messageQueue.push({ kind: 'guess_song_next_round' });
        });

        this.skipButton = new Button('Skip', this.userInput, () => {
            this.messageQueue.push({ kind: 'guess_song_skip' });
        });

        this.modeButtons = [
            { button: new Button('Genere', this.userInput, () => this.selectedMode = 'genre'), mode: 'genre' },
            { button: new Button('Artista', this.userInput, () => this.selectedMode = 'artist'), mode: 'artist' },
        ];

        this.genres.forEach((genre) => {
            this.genreButtons.push({
                button: new Button(genre, this.userInput, () => {
                    this.selectedGenre = genre;
                    this.selectedItalianEra = null;
                    this.selectedMode = 'genre';
                }),
                genre,
            });
        });

        this.italianEras.forEach((era) => {
            this.italianEraButtons.push({
                button: new Button(era, this.userInput, () => {
                    this.selectedItalianEra = era;
                    this.selectedMode = 'genre';
                }),
                era,
            });
        });

        this.roundOptions.forEach((roundCount) => {
            this.roundButtons.push({
                button: new Button(`${roundCount} round`, this.userInput, () => {
                    this.selectedRounds = roundCount;
                }),
                count: roundCount,
            });
        });

        document.addEventListener('keydown', (e) => {
            if (!this.gameState || this.gameState.phase !== 'playing') return;
            if (e.key === 'Enter' && this.currentGuess.trim() !== '') {
                this.messageQueue.push({ kind: 'guess_song_submit', guess: this.currentGuess.trim() });
                this.currentGuess = '';
            } else if (e.key === 'Backspace') {
                this.currentGuess = this.currentGuess.slice(0, -1);
            } else if (e.key.length === 1) {
                this.currentGuess += e.key;
            }
        });
    }

    init(players: Record<string, Player>) {
        this.players = players;
        return Promise.resolve();
    }

    private sendSelection() {
        if (this.selectedMode === 'genre') {
            const genreValue = this.selectedItalianEra ? `Italia ${this.selectedItalianEra}` : this.selectedGenre;
            if (!genreValue) {
                this.errorMessage = 'Scegli un genere o un decennio italiano.';
                return;
            }
            this.messageQueue.push({ kind: 'guess_song_option', mode: 'genre', value: genreValue, rounds: this.selectedRounds });
            this.errorMessage = null;
        } else {
            const artist = this.artistInput.getValue().trim();
            if (!artist) {
                this.errorMessage = 'Inserisci il nome di un artista.';
                return;
            }
            this.messageQueue.push({ kind: 'guess_song_option', mode: 'artist', value: artist, rounds: this.selectedRounds });
            this.errorMessage = null;
        }
    }

    private createAudio(url: string) {
        if (this.audio) {
            this.audio.pause();
            this.audio = null;
        }
        this.audio = new Audio(url);
        this.audio.play().catch(() => {
            // L'autoplay potrebbe essere bloccato se non ci sono interazioni recenti.
        });
    }

    draw(ctx: CanvasRenderingContext2D, dt: number) {
        const { screenW, screenH } = this.userInput;
        ctx.fillStyle = '#0b1020';
        ctx.fillRect(0, 0, screenW, screenH);

        if (!this.gameState) {
            ctx.fillStyle = '#ffffff';
            ctx.font = 'bold 32px Arial';
            ctx.textAlign = 'center';
            ctx.fillText('Caricamento del gioco...', screenW / 2, screenH / 2);
            return;
        }

        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 42px Arial';
        ctx.textAlign = 'center';
        ctx.fillText('Guess the Song', screenW / 2, 80);

        if (this.gameState.phase === 'selection') {
            this.drawSelectionScreen(ctx, screenW, screenH);
        } else if (this.gameState.phase === 'loading') {
            this.drawLoadingScreen(ctx, screenW, screenH);
        } else if (this.gameState.phase === 'playing' || this.gameState.phase === 'round_over' || this.gameState.phase === 'game_over') {
            this.drawPlayingScreen(ctx, screenW, screenH);
        }

        this.exitButton.draw(ctx, 20, screenH - 70, 120, 50);
    }

    private drawSelectionScreen(ctx: CanvasRenderingContext2D, screenW: number, screenH: number) {
        ctx.font = '24px Arial';
        ctx.fillText('Scegli un genere o inserisci un artista', screenW / 2, 140);

        const buttonW = 140;
        const buttonH = 50;
        const spacing = 20;
        const totalWidth = this.modeButtons.length * buttonW + (this.modeButtons.length - 1) * spacing;
        let x = screenW / 2 - totalWidth / 2;
        const y = 180;

        this.modeButtons.forEach((item) => {
            const isActive = item.mode === this.selectedMode;
            item.button.setColors({ main: isActive ? '#5a9df2' : '#3d5a80' });
            item.button.draw(ctx, x, y, buttonW, buttonH);
            x += buttonW + spacing;
        });

        if (this.selectedMode === 'genre') {
            ctx.font = '22px Arial';
            ctx.fillText('Generi disponibili:', screenW / 2, 260);
            const genresPerRow = 3;
            const genreButtonW = 180;
            const genreButtonH = 50;
            const totalGenresWidth = genresPerRow * genreButtonW + (genresPerRow - 1) * spacing;
            let startX = screenW / 2 - totalGenresWidth / 2;
            let yPos = 300;
            this.genreButtons.forEach((item, index) => {
                item.button.setEnabled(true);
                const col = index % genresPerRow;
                const row = Math.floor(index / genresPerRow);
                const xPos = startX + col * (genreButtonW + spacing);
                const yRow = yPos + row * (genreButtonH + spacing);
                item.button.setColors({ main: item.genre === this.selectedGenre && !this.selectedItalianEra ? '#d18800' : '#4d4d4d' });
                item.button.draw(ctx, xPos, yRow, genreButtonW, genreButtonH);
            });
            this.artistInput.setEnabled(false);

            ctx.font = '22px Arial';
            ctx.fillText('Italia per decennio:', screenW / 2, yPos + 220);
            const eraButtonW = 140;
            const eraButtonH = 40;
            const eraTotalWidth = 4 * eraButtonW + 3 * spacing;
            const eraRows = Math.ceil(this.italianEraButtons.length / 4);
            const eraStartY = yPos + 260;
            let eraX = screenW / 2 - eraTotalWidth / 2;
            let eraY = eraStartY;
            this.italianEraButtons.forEach((item, index) => {
                if (index >= 4) {
                    const row = Math.floor(index / 4);
                    eraY = eraStartY + row * (eraButtonH + 10);
                    eraX = screenW / 2 - eraTotalWidth / 2 + (index % 4) * (eraButtonW + spacing);
                }
                item.button.setEnabled(true);
                item.button.setColors({ main: item.era === this.selectedItalianEra ? '#d18800' : '#4d4d4d' });
                item.button.draw(ctx, eraX, eraY, eraButtonW, eraButtonH);
                eraX += eraButtonW + spacing;
            });
            const roundLabelY = eraStartY + eraRows * eraButtonH + (eraRows - 1) * 10 + 60;
            ctx.font = '22px Arial';
            ctx.fillText('Numero di round:', screenW / 2, roundLabelY);
            const roundButtonW = 140;
            const roundButtonH = 40;
            const roundTotalWidth = this.roundButtons.length * roundButtonW + (this.roundButtons.length - 1) * spacing;
            let roundX = screenW / 2 - roundTotalWidth / 2;
            const roundY = roundLabelY + 40;
            this.roundButtons.forEach((item) => {
                item.button.setColors({ main: item.count === this.selectedRounds ? '#d18800' : '#4d4d4d' });
                item.button.draw(ctx, roundX, roundY, roundButtonW, roundButtonH);
                roundX += roundButtonW + spacing;
            });

            this.startButton.setColors({ main: '#58a515' });
            this.startButton.draw(ctx, screenW / 2 - 90, roundY + 80, 180, 60);

            if (this.errorMessage) {
                ctx.fillStyle = '#ff6961';
                ctx.fillText(this.errorMessage, screenW / 2, roundY + 140);
            }
            return;
        } else {
            ctx.font = '22px Arial';
            ctx.fillText('Cerca per artista', screenW / 2, 260);
            this.genreButtons.forEach((item) => item.button.setEnabled(false));
            this.artistInput.setEnabled(true);
            this.artistInput.draw(ctx, screenW / 2 - 280, 300, 560, 60);
        }

        ctx.font = '22px Arial';
        ctx.fillText('Numero di round:', screenW / 2, screenH - 320);
        const roundButtonW = 140;
        const roundButtonH = 40;
        const roundTotalWidth = this.roundButtons.length * roundButtonW + (this.roundButtons.length - 1) * spacing;
        let roundX = screenW / 2 - roundTotalWidth / 2;
        const roundY = screenH - 280;
        this.roundButtons.forEach((item) => {
            item.button.setColors({ main: item.count === this.selectedRounds ? '#d18800' : '#4d4d4d' });
            item.button.draw(ctx, roundX, roundY, roundButtonW, roundButtonH);
            roundX += roundButtonW + spacing;
        });

        this.startButton.setColors({ main: '#58a515' });
        this.startButton.draw(ctx, screenW / 2 - 90, screenH - 180, 180, 60);

        if (this.errorMessage) {
            ctx.fillStyle = '#ff6961';
            ctx.fillText(this.errorMessage, screenW / 2, screenH - 120);
        }
    }

    private drawLoadingScreen(ctx: CanvasRenderingContext2D, screenW: number, screenH: number) {
        ctx.font = '28px Arial';
        ctx.fillText('Sto cercando un brano su iTunes...', screenW / 2, screenH / 2 - 20);
        if (this.gameState?.errorMessage) {
            ctx.fillStyle = '#ff6961';
            ctx.fillText(this.gameState.errorMessage, screenW / 2, screenH / 2 + 40);
        }
    }

    private drawPlayingScreen(ctx: CanvasRenderingContext2D, screenW: number, screenH: number) {
        const state = this.gameState!;

        if (state.gameOver) {
            ctx.font = 'bold 36px Arial';
            ctx.fillStyle = '#4CAF50';
            const winnerName = this.players[state.winnerId!]?.name || 'Giocatore';
            ctx.fillText(`${winnerName} ha indovinato l'ultimo round!`, screenW / 2, screenH / 2 + 120);
            if (state.actualArtistName && state.actualTrackName) {
                ctx.font = '24px Arial';
                ctx.fillText(`Il brano era: ${state.actualArtistName} - ${state.actualTrackName}`, screenW / 2, screenH / 2 + 170);
            }
            ctx.font = '22px Arial';
            ctx.fillText('Classifica finale:', screenW / 2, screenH / 2 + 220);
            ctx.textAlign = 'left';
            const ranking = Object.entries(state.scores)
                .map(([id, score]) => ({ playerName: this.players[id]?.name || 'Giocatore', score }))
                .sort((a, b) => b.score - a.score);
            ranking.forEach((entry, index) => {
                ctx.fillText(`${index + 1}. ${entry.playerName}: ${entry.score}`, screenW / 2 - 200, screenH / 2 + 260 + index * 26);
            });
            ctx.textAlign = 'center';
            return;
        }

        if (state.phase === 'round_over') {
            ctx.fillStyle = '#FFBA49';
            ctx.font = 'bold 36px Arial';
            if (state.errorMessage && !state.roundWinner) {
                ctx.fillText(state.errorMessage, screenW / 2, screenH / 2 + 120);
                return;
            }
            ctx.fillText(`${state.roundWinner || 'Un giocatore'} ha vinto il round!`, screenW / 2, screenH / 2 + 120);
            if (state.actualArtistName && state.actualTrackName) {
                ctx.font = '24px Arial';
                ctx.fillText(`Il brano era: ${state.actualArtistName} - ${state.actualTrackName}`, screenW / 2, screenH / 2 + 170);
            }
            this.nextRoundButton.draw(ctx, screenW / 2 - 120, screenH / 2 + 220, 240, 50);
            return;
        }

        ctx.font = '24px Arial';
        ctx.fillStyle = '#ffffff';
        ctx.fillText('Ascolta il preview e indovina il brano', screenW / 2, 140);

        ctx.font = '20px Arial';
        ctx.fillText(`Round ${state.currentRound} / ${state.totalRounds}`, screenW / 2, 170);
        ctx.fillText(`Titolo: ${state.trackNameMask || '_______'}`, screenW / 2, 200);
        ctx.fillText(`Suggerimenti ogni ${state.hintIntervalSeconds} secondi`, screenW / 2, 230);

        let hintY = 260;
        if (state.hintStage >= 1) {
            ctx.fillText(`Artista: ${state.artistHint?.charAt(0) || ''}...`, screenW / 2, hintY);
            hintY += 30;
        }
        if (state.hintStage >= 2) {
            ctx.fillText(`Genere: ${state.genreHint || '---'}`, screenW / 2, hintY);
            hintY += 30;
        }
        if (state.hintStage >= 3) {
            ctx.fillText(`Album: ${state.albumHint || '---'}`, screenW / 2, hintY);
            hintY += 30;
        }

        ctx.fillStyle = '#eeeeee';
        ctx.fillRect(screenW / 2 - 320, screenH / 2 - 40, 640, 80);
        ctx.fillStyle = '#000000';
        ctx.font = '28px Arial';
        ctx.fillText(this.currentGuess || 'Scrivi il titolo e premi Enter', screenW / 2, screenH / 2 + 10);

        const skipCount = Object.keys(state.skipVotes).length;
        const totalPlayers = Object.keys(this.players).length;
        const skipThreshold = Math.min(4, totalPlayers);
        ctx.font = '18px Arial';
        ctx.fillStyle = '#cccccc';
        ctx.fillText(`Skip votati: ${skipCount} / ${skipThreshold}`, screenW / 2, screenH / 2 + 70);

        const hasVotedSkip = state.skipVotes[this.myId] === true;
        const hasReachedMaxSkips = state.skipsThisRound >= 4;
        const skipEnabled = state.phase === 'playing' && !state.gameOver && !hasVotedSkip && !hasReachedMaxSkips;
        this.skipButton.setLabel(hasReachedMaxSkips ? 'Skip max raggiunto' : hasVotedSkip ? 'Skip (votato)' : 'Skip');
        this.skipButton.setEnabled(skipEnabled);
        this.skipButton.setColors({ main: '#d32f2f', text: '#e6e6e6' });
        this.skipButton.draw(ctx, screenW / 2 - 70, screenH / 2 + 90, 140, 45);

        ctx.font = '18px Arial';
        ctx.fillStyle = '#cccccc';
        ctx.fillText('Cronologia ultimi tentativi:', screenW / 2, screenH / 2 + 180);
        ctx.textAlign = 'left';
        this.gameState.guesses.slice(-5).forEach((guess, idx) => {
            const yPos = screenH / 2 + 210 + idx * 24;
            ctx.fillText(`${guess.playerName}: ${guess.guess}`, screenW / 2 - 300, yPos);
        });
        ctx.textAlign = 'center';
    }

    handleMessage(message: any) {
        if (message.kind === 'guess_song_update') {
            this.gameState = message.gameState;
            this.lastGuessResult = message.lastGuess || null;
            if (this.gameState.previewUrl) {
                this.createAudio(this.gameState.previewUrl);
            }
            if (this.gameState.errorMessage) {
                this.errorMessage = this.gameState.errorMessage;
            }
        }
    }

    flushMessages(): any[] {
        const messages = this.messageQueue;
        this.messageQueue = [];
        return messages;
    }

    isFinished(): boolean {
        return this.userExited;
    }
}
