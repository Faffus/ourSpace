# Minecraft2D - Documentazione attuale

Questo documento descrive la versione attuale di Minecraft2D: un minigame 2D multiplayer in TypeScript chiamato internamente Minecraft Diamond Rush. Il server resta autoritativo, il mondo e a blocchi e il primo player che rompe il diamante nascosto vince la partita.

## 1. Obiettivo del progetto

L'esperienza deve essere leggibile e competitiva. Il gioco prende solo gli elementi utili a una corsa al diamante chiara e veloce da capire.

Obiettivi principali:

- match con durata configurabile; nella build attuale il timer dura 60 minuti;
- accesso immediato al gameplay, senza menu complessi;
- mining come asse centrale del bilanciamento;
- PvP presente ma non dominante;
- progressione semplice, facile da leggere e da estendere;
- regole controllate dal server, mai dal client.

## 2. Visione di gioco

Il flusso base di una partita e questo:

1. I player spawnano in superficie.
2. Scavano verso il sottosuolo.
3. Raccolgono risorse utili e migliorano mining, costruzione e combattimento.
4. Si scontrano in PvP leggero solo quando conviene.
5. Il primo player che rompe il diamante vince.
6. Se il tempo finisce, il server assegna la vittoria a chi e piu vicino al diamante.

La partita deve restare tesa e leggibile. Il combattimento serve a disturbare, non a sostituire il mining.

## 3. Requisiti funzionali

La UI e il gameplay attuali includono:

- nome visibile sopra ogni player;
- skin casuale assegnata dal server;
- HP visibili sopra il player e nell'HUD;
- barra centrale con 6 slot per materiali e blocchi piazzabili;
- ogni slot mostra icona, quantita e stato di selezione;
- riquadro separato per piccone e spada con il tier attuale;
- blocco puntato con nome e feedback visivo;
- blocco non raggiungibile evidenziato con tinta leggermente rossa;
- blocchi piazzabili limitati a dirt, stone e trunk;
- nessun item iniziale per i player;
- crafting e piazzamento validati dal server;
- segnali chiari su profondita, tempo residuo e obiettivo.

## 4. Stack tecnico

### Client

- TypeScript in strict mode a livello di progetto quando possibile;
- HTML5 Canvas 2D;
- input tastiera e mouse;
- interpolazione lato client per un movimento fluido;
- HUD e rendering separati dalla logica di rete.

### Server

- Node.js;
- WebSocket con `ws`;
- simulazione autoritativa;
- validazione di mining, combat, crafting, collisioni e respawn.

### Shared

- tipi comuni tra client e server;
- costanti di bilanciamento condivise;
- schema eventi rete;
- modelli per player, mondo, snapshot e risultati partita.

## 5. Responsabilita dei file

### `index.ts`

Esporta client e server della modalita.

### `client.ts`

Gestisce input, rendering Canvas, HUD, tooltip del blocco puntato, hotbar, barra ricette, riquadri di equipaggiamento, overlay finale e interpolazione degli altri player.

### `server.ts`

Gestisce lo stato autoritativo, la validazione degli input, il mining, il combattimento, il crafting, il piazzamento dei blocchi, il respawn, il timeout e la vittoria.

### `world.ts`

Gestisce seed, generazione del terreno, posizione del diamante nascosto, lettura e scrittura dei blocchi, chunk e aree modificabili.

### `physics.ts`

Gestisce gravita, salto e collisioni box vs tile.

### `recipes.ts`

Contiene le ricette data-driven e le scorciatoie numeriche usate dal client.

### `sync.ts`

Deriva il miglior tier di piccone e spada dall'inventario e costruisce lo stato pubblico e privato del player.

### `constants.ts`

Raccoglie i valori di bilanciamento condivisi.

### `types.ts`

Contiene i tipi condivisi per blocchi, player, snapshot, delta e messaggi.

### `utils.ts`

Contiene helper per chunk, tile, distanza e calcoli di supporto.

## 6. Modello del mondo

### 6.1 Griglia a blocchi

Il mondo e una griglia bidimensionale. Ogni cella contiene un solo blocco principale.

Coordinate di riferimento:

- `x` orizzontale;
- `y` verticale;
- `y = 0` superficie;
- `y < 0` sottosuolo;
- `y > 0` cielo o zona alta, se prevista.

### 6.2 Stati dei blocchi

Tipi di blocco previsti:

- `air`
- `grass`
- `dirt`
- `stone`
- `trunk`
- `iron_ore`
- `diamond`
- blocchi piazzati dal player: `dirt`, `stone`, `trunk`.

### 6.3 Chunk-based

Il mondo e diviso in chunk da 16x16. Questo aiuta la generazione, la serializzazione e l'invio parziale dei dati ai client vicini ai player.

### 6.4 Superficie

La superficie deve essere leggibile e riconoscibile. Deve contenere:

- strato di erba;
- uno o piu strati di terra;
- eventuali tronchi semplicissimi;
- punti di spawn dei player.

### 6.5 Sottosuolo

Sotto la superficie ci sono terra, pietra, minerali e diamanti. La profondita deve far percepire progressione: i primi livelli sono rapidi, quelli profondi sono piu rischiosi e piu remunerativi.

## 7. Generazione procedurale

### 7.1 Concetto generale

La generazione e deterministica rispetto a un seed condiviso. Tutti i client vedono lo stesso mondo e il server rimane l'unica fonte di verita.

### 7.2 Algoritmo attuale

La generazione e gestita da `world.ts`:

1. si calcola la superficie con rumore deterministico;
2. si posizionano grass e dirt sopra e sotto la superficie;
3. sotto la superficie si passa a stone;
4. si inseriscono tronchi semplici sopra terra con probabilita controllata;
5. si inserisce iron ore nel sottosuolo;
6. si sceglie una sola posizione per il diamante nascosto.

### 7.3 Bilanciamento della rarita

I minerali sono leggermente piu rari del normale. Il diamante resta profondo e non compare in superficie.

Valori attuali di riferimento:

- diamante in profondita significativa, tra `y = -72` e `y = -30`;
- iron ore con probabilita moderata;
- tronchi semplici e leggibili sopra terra;
- nessun coal ore, nessun leaf e nessun diamond ore nel codice attuale.

### 7.4 Diamante nascosto

Il diamante e unico. Il server decide la sua posizione all'avvio della partita, la conserva in modo privato e la rivela ai client solo quando viene rotto o quando scade il match.

## 8. Fisica del personaggio

La fisica deve essere semplice, stabile e adatta a un gioco platform/mining 2D.

### 8.1 Stati base

Ogni player ha:

- posizione `x, y`;
- velocita `vx, vy`;
- stato `onGround`.

### 8.2 Movimento

Il player puo muoversi a sinistra e destra, saltare quando e a terra e interagire con il mondo. La risposta deve essere arcade: rapida, leggibile e poco rigida.

### 8.3 Collisioni

Le collisioni sono box vs tile. La correzione di posizione avviene in modo separato su asse orizzontale e verticale. Il player non deve attraversare muri, pavimenti o blocchi solidi.

### 8.4 Caduta nel sottosuolo

I corridoi e le cavita devono rimanere giocabili: caduta libera, appoggio sui blocchi e uscita con salto devono funzionare in modo affidabile.

## 9. Mining

Il mining e la meccanica centrale.

### 9.1 Flusso

Il player mira un blocco, verifica che sia raggiungibile, tiene premuto il tasto sinistro e il server accumula tempo di rottura. Quando il tempo supera la soglia, il blocco si rompe.

### 9.2 Tempo di rottura

Il tempo di mining dipende da:

- tipo di blocco;
- tier del tool migliore nell'inventario;
- eventuali effetti futuri;
- stato del player.

Indicazioni attuali:

- terra veloce;
- pietra media;
- iron ore piu lento;
- diamante il piu impegnativo tra i blocchi importanti.

### 9.3 Tier del piccone

Il gioco risolve il miglior tier di piccone presente nell'inventario. Gli upgrade non eliminano necessariamente i tier precedenti, ma il client mostra sempre quello migliore disponibile.

### 9.4 Blocco puntato

Quando il player punta un blocco, il client mostra il suo nome e un feedback visivo. Se il blocco non e raggiungibile, il feedback diventa rosso per comunicare il fallimento immediato.

### 9.5 Rottura e drop

Quando il blocco si rompe, il server aggiorna il mondo. Il blocco diventa `air`, eventuali drop vengono gestiti e, se il blocco era un diamante, scatta la vittoria.

## 10. Vittoria

Regola principale: il primo che rompe il diamante vince.

Conseguenze lato server:

- blocco degli input gameplay rilevanti;
- stop di mining, combat e piazzamento;
- aggiornamento del `summary` di partita;
- invio di snapshot e delta con lo stato finale.

Conseguenze lato client:

- schermata finale;
- nome vincitore evidenziato;
- motivo di chiusura leggibile.

## 11. Durata partita

La partita dura al massimo 60 minuti nella build attuale.

Alla scadenza il server calcola la distanza di ogni player dal diamante nascosto e assegna la vittoria a chi e piu vicino. Se la distanza e troppo simile, il risultato puo diventare un pareggio.

## 12. PvP leggero

Il combattimento esiste, ma resta secondario.

### Regole base

- attacco con `F`;
- range corto;
- cooldown di 550 ms;
- danno base di 18, con bonus in base alla spada migliore in inventario;
- knockback leggero;
- niente kill istantanea.

### Ruolo del PvP

Il PvP serve a:

- disturbare l'avversario;
- rallentare chi sta scavando bene;
- creare decisioni tattiche rapide;
- non trasformare il gioco in un deathmatch puro.

### HP

Ogni player ha 100 HP visibili sopra il personaggio e nell'HUD.

## 13. Respawn

Il respawn e rapido. Dopo una sconfitta o una morte, il player torna alla propria spawn dopo 2 secondi con HP pieni. L'inventario raccolto non viene azzerato.

## 14. Inventario e hotbar

### 14.1 Nessun item iniziale

Ogni player comincia da zero: nessun item, nessun tool, nessuna risorsa.

### 14.2 Barra centrale a 6 slot

La UI usa una barra centrale con 6 slot. Ogni slot mostra icona, quantita e stato di selezione.

Gli slot attuali sono pensati per:

- dirt;
- stone;
- trunk;
- wood;
- iron;
- pickaxe_wood.

### 14.3 Slot separato per equipaggiamento

Il client mostra a destra il piccone e la spada con il tier migliore disponibile. Questo stato deriva dall'inventario e non da un equipaggiamento complesso.

### 14.4 Barra ricette

La UI include una barra ricette sempre visibile. Mostra le ricette disponibili e quelle non ancora craftabili, senza obbligare il player ad aprire menu pesanti.

## 15. Crafting

Il crafting e descritto come dati in `recipes.ts`.

Ricette attuali:

- `craft_pickaxe_wood`: 3 wood -> wood pickaxe;
- `craft_sword_stone`: 1 wood + 3 stone -> stone sword;
- `craft_sword_iron`: 1 wood + 3 iron -> iron sword;
- `upgrade_pickaxe_stone`: 2 wood + 4 stone -> stone pickaxe;
- `upgrade_pickaxe_iron`: 2 wood + 4 iron -> iron pickaxe.

Il server verifica sempre la disponibilita dei materiali. Il client puo solo mostrare l'interfaccia e inviare la richiesta.

## 16. Nome player, skin e HP

Ogni player deve essere riconoscibile al primo colpo d'occhio.

### Nome visibile

Il nome va mostrato sopra la testa del personaggio, con contrasto sufficiente e aggiornamento in tempo reale.

### Skin casuale

Il server assegna una skin casuale da un set predefinito o da un seed condiviso. Le skin devono essere semplici, pixel-friendly e distinguibili.

### HP visibili

Il valore HP deve comparire sia sopra il player sia nell'HUD, cosi il giocatore capisce subito lo stato degli altri e il proprio.

## 17. UI di puntamento blocco

Quando il cursore punta un blocco:

- il nome del blocco compare in overlay;
- il feedback visivo segnala se il blocco e raggiungibile;
- se non lo e, il blocco o il contorno assume una tinta leggermente rossa.

Questa regola riduce la confusione e rende il mining piu leggibile.

## 18. Multiplayer

### 18.1 Server autoritativo

Il server controlla la verita di:

- posizione dei player;
- collisioni;
- mining;
- crafting;
- danni;
- spawn;
- vittoria.

Il client invia input, riceve snapshot e renderizza lo stato.

### 18.2 Input inviato dal client

Il client manda al server:

- `input` per movimento e salto;
- `mine_start` e `mine_stop` per il mining;
- `attack` per il melee;
- `craft` per il crafting;
- `select_placeable` per cambiare blocco piazzabile;
- `place_block` per il piazzamento.

Il server deve validare distanza, frequenza, cooldown e disponibilita risorse.

### 18.3 Snapshot e delta update

Per ridurre il traffico:

- snapshot completi o quasi completi a intervalli regolari;
- delta update per blocchi rotti, movimento e stati rilevanti;
- aggiornamenti coerenti e deterministici.

### 18.4 Interpolazione client-side

Il client deve interpolare le posizioni per evitare salti visivi. La verita resta sempre del server, ma il rendering deve sembrare fluido.

## 19. Sistema di rete

Eventi principali attuali:

- `input`
- `mine_start`
- `mine_stop`
- `attack`
- `craft`
- `select_placeable`
- `place_block`
- `snapshot`
- `delta`

Il server deve ignorare gli input illegittimi e ricalcolare gli stati sensibili. La vittoria viene comunicata dentro `summary` nei messaggi di stato.

## 20. Rendering

### 20.1 Canvas 2D

Il rendering avviene su HTML5 Canvas con overlay UI sopra il mondo.

### 20.2 Stile grafico

Lo stile deve essere semplice, pixel-friendly e leggibile. La priorita non e la complessita estetica, ma la chiarezza durante il gioco.

### 20.3 Elementi da disegnare

- terreno;
- sottosuolo;
- tronchi;
- iron ore;
- il player con skin casuale;
- nomi e HP;
- blocco puntato con stato di raggiungibilita;
- hotbar centrale;
- riquadri separati di piccone e spada;
- barra ricette;
- profondita;
- diamond ping quando il diamante viene rivelato;
- schermata finale di vittoria.

### 20.4 Effetti visivi

Gli effetti attuali sono minimi ma utili:

- highlight del blocco puntato;
- feedback rosso quando il blocco e fuori portata;
- diamond ping quando la posizione viene rivelata;
- overlay finale con il vincitore.

## 21. Indicatore di profondita

Un indicatore di profondita e utile per capire quanto il player si sta avvicinando alla zona dei diamanti. Puo essere una barra o un testo semplice nell'HUD.

## 22. Mini-mappa

La mini-mappa e opzionale, ma puo mostrare:

- posizione relativa del player;
- altri player;
- eventuali zone esplorate.

Non deve mai mostrare i diamanti in chiaro, altrimenti rovina il gioco.

## 23. Seed condiviso

Il seed deve essere condiviso tra server e client per rendere il mondo replicabile e coerente. Il server puo generarlo all'avvio della partita e inviarlo ai client al join.

## 24. Regole di bilanciamento consigliate

Per mantenere il gioco divertente:

- spawn iniziale in superficie;
- area iniziale abbastanza ampia;
- strumenti iniziali assenti;
- prime risorse reperibili presto;
- minerali un po' piu rari del normale;
- diamanti piu presenti del concept base, ma ancora profondi;
- mining del diamante piu lento;
- PvP utile ma non dominante;
- respawn rapido;
- match breve.

## 25. Sicurezza e anti-cheat base

Il server deve controllare sempre:

- distanza mining;
- velocita movimento;
- tempi attacco;
- crafting valido;
- possessione item;
- collisioni;
- dichiarazioni di vittoria.

Il client non deve mai poter:

- rompere blocchi fuori range;
- creare item dal nulla;
- impostare la posizione arbitrariamente;
- dichiararsi vincitore.

## 26. Flusso completo di una partita

### Start

- il server genera il seed;
- crea il mondo;
- sceglie la posizione del diamante;
- assegna skin casuali;
- assegna nomi e HP iniziali;
- tutti partono senza item.

### Early game

- i player scavano terra e tronchi;
- trovano pietra e ferro;
- aprono le ricette utili;
- iniziano a selezionare il blocco piazzabile migliore.

### Mid game

- aumenta la tensione;
- i player iniziano a cercarsi;
- il mining va piu in profondita;
- il vantaggio tecnico conta piu della fortuna pura.

### End game

- un player trova e rompe il diamante;
- il server registra la vittoria nel summary;
- tutti vedono il vincitore o il pareggio finale.

## 27. Conclusione

Minecraft2D deve essere un minigame leggibile e semplice da espandere. La struttura piatta, i file con responsabilita precise, il server autoritativo e la UI compatta servono tutti allo stesso obiettivo: rendere chiara la corsa al diamante senza appesantire il giocatore con complessita inutili.

Le scelte piu importanti sono:

- hotbar centrale da 6 slot;
- tier di pickaxe e sword risolti dall'inventario;
- nome, skin e HP visibili;
- blocco puntato ben segnalato;
- barra ricette sempre presente;
- niente inventario pesante;
- tronchi semplici;
- minerali piu rari e diamante profondo;
- match con server autoritativo e summary finale.

Questi vincoli danno al progetto una identita chiara e una base solida per future estensioni.