// The only thing in Bop Quiz that makes sound. It runs on the host screen;
// phones never load it.
//
// Two decks, like a DJ's: while one plays, the other loads the next preview,
// and every change of song is a crossfade between them. Both run through one
// Web Audio graph, which also feeds the spectrum the record's halo draws. The
// iTunes CDN sends `access-control-allow-origin: *`, so the analyser gets
// real samples.

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** -60 dB. An exponential ramp cannot reach zero, so fades run to here and then cut. */
const SILENCE = 0.001;

/** A wave as a 16-bit mono WAV file, `seconds` long, sample by sample. */
function wav(seconds: number, sample: (t: number) => number): string {
  const rate = 44100;
  const samples = Math.floor(rate * seconds);
  const bytes = new Uint8Array(44 + samples * 2);
  const view = new DataView(bytes.buffer);
  const text = (at: number, s: string) => [...s].forEach((c, i) => view.setUint8(at + i, c.charCodeAt(0)));
  text(0, 'RIFF');
  view.setUint32(4, 36 + samples * 2, true);
  text(8, 'WAVEfmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  text(36, 'data');
  view.setUint32(40, samples * 2, true);
  for (let i = 0; i < samples; i++) {
    const value = Math.max(-1, Math.min(1, sample(i / rate)));
    view.setInt16(44 + i * 2, Math.round(value * 32767), true);
  }
  return URL.createObjectURL(new Blob([bytes], { type: 'audio/wav' }));
}

/** A twentieth of a second of silence. */
function silence(): string {
  return wav(0.05, () => 0);
}

/** The sound check: four rising bell notes, a major arpeggio, ringing out. */
function chimeClip(): string {
  const notes = [523.25, 659.25, 783.99, 1046.5];
  const step = 0.16;
  return wav(1.9, (t) => {
    let sum = 0;
    notes.forEach((hz, i) => {
      const at = t - i * step;
      if (at < 0) return;
      const attack = Math.min(at / 0.006, 1);
      const ring = Math.exp(-at * 3.2);
      // A bell is mostly its note, with a little of the octave above.
      sum += attack * ring * (Math.sin(2 * Math.PI * hz * at) + 0.25 * Math.sin(4 * Math.PI * hz * at));
    });
    return sum * 0.28;
  });
}

interface Deck {
  audio: HTMLAudioElement;
  gain: GainNode | null;
  /** What the gain should sit at while this deck is the one being heard. */
  volume: number;
  /** Bumped by every load, so a superseded load cannot resolve as the new one. */
  loads: number;
}

function newDeck(): Deck {
  const audio = new Audio();
  audio.crossOrigin = 'anonymous';
  audio.preload = 'auto';
  return { audio, gain: null, volume: 1, loads: 0 };
}

export interface StartOptions {
  /** Seconds into the preview to start from. */
  offset?: number;
  loop?: boolean;
  volume?: number;
  /** Seconds for the new song to rise to `volume`. */
  fadeIn?: number;
  /** Seconds for whatever was playing to fall away underneath it. */
  fadeOutOld?: number;
}

export class Jukebox {
  private decks: [Deck, Deck] = [newDeck(), newDeck()];
  /** Index of the deck the room is hearing. The other one is free to load. */
  private live = 0;
  private context: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  /** Both decks pass through this on the way out, so the sound check can duck the music without touching a fade. */
  private music: GainNode | null = null;
  private spectrum: Uint8Array<ArrayBuffer> | null = null;
  private prefetcher: HTMLAudioElement | null = null;
  private primed = false;
  /** Bumped to stop a running playlist. */
  private playlistRun = 0;
  private held = false;
  /** Whether the live deck was playing when the game was paused. */
  private resumeOnRelease = false;
  private runout: { source: AudioBufferSourceNode; gain: GainNode } | null = null;
  private unlocking: Promise<void> | null = null;
  /** The sound check's own player, wired into the same graph as the decks. */
  private chimer: HTMLAudioElement | null = null;

  /**
   * Browsers only let sound start from a click. Call this from one; after
   * that the jukebox may play for the rest of the page's life.
   */
  unlock(): Promise<void> {
    // A tap is a pointerdown and then a click, and a screen may answer both.
    // They share one unlock: a second priming would cut the first one off.
    this.unlocking ??= this.doUnlock().finally(() => {
      this.unlocking = null;
    });
    return this.unlocking;
  }

  private async doUnlock(): Promise<void> {
    if (!this.context) {
      const context = new AudioContext();
      const analyser = context.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.82;
      analyser.connect(context.destination);
      const music = context.createGain();
      music.connect(analyser);
      for (const deck of this.decks) {
        deck.gain = context.createGain();
        deck.gain.gain.value = 0;
        context.createMediaElementSource(deck.audio).connect(deck.gain).connect(music);
      }
      this.context = context;
      this.music = music;
      this.analyser = analyser;
      this.spectrum = new Uint8Array(analyser.frequencyBinCount);
    }
    if (this.context.state !== 'running') await this.context.resume();
    // Safari blesses each media element separately, and only for a play()
    // made inside a click. Spend this click on a moment of silence per deck.
    if (!this.primed) {
      const clip = silence();
      await Promise.all(
        this.decks.map((deck) => {
          if (deck.audio.src) return;
          deck.audio.src = clip;
          return deck.audio.play();
        }),
      );
      this.primed = true;
    }
  }

  get unlocked(): boolean {
    return this.context?.state === 'running';
  }

  private get idle(): Deck {
    return this.decks[1 - this.live];
  }

  /**
   * Fade the deck to `to` over `seconds`. The ramp is exponential, which is
   * a straight line in decibels: hearing is logarithmic, so a linear ramp
   * sits at nearly full volume for most of its length and then drops at the
   * end, while this one is heard to move the whole way.
   */
  private ramp(deck: Deck, to: number, seconds: number): void {
    if (!deck.gain || !this.context) return;
    const now = this.context.currentTime;
    const gain = deck.gain.gain;
    // Read before cancelling: cancelling an unfinished ramp can snap the
    // value back to where that ramp began.
    const from = Math.max(gain.value, SILENCE);
    const end = now + Math.max(seconds, 0.02);
    gain.cancelScheduledValues(now);
    gain.setValueAtTime(from, now);
    gain.exponentialRampToValueAtTime(Math.max(to, SILENCE), end);
    if (to < SILENCE) gain.setValueAtTime(0, end);
  }

  /** Seconds of the song the room is hearing that are left; Infinity until known. */
  remaining(): number {
    const { audio } = this.decks[this.live];
    if (audio.paused || !Number.isFinite(audio.duration)) return audio.paused ? 0 : Infinity;
    return Math.max(audio.duration - audio.currentTime, 0);
  }

  /**
   * Load `url` onto the free deck while the live one keeps playing. Resolves
   * once enough has arrived to play without stalling.
   */
  cue(url: string, timeoutMs = 8000): Promise<void> {
    this.playlistRun++;
    return this.load(url, timeoutMs);
  }

  private load(url: string, timeoutMs = 8000): Promise<void> {
    const deck = this.idle;
    const mine = ++deck.loads;
    return new Promise((resolve, reject) => {
      const { audio } = deck;
      const done = (error?: Error) => {
        clearTimeout(timer);
        audio.removeEventListener('canplaythrough', onReady);
        audio.removeEventListener('error', onError);
        if (mine !== deck.loads) reject(new Error('Superseded by a newer song.'));
        else if (error) reject(error);
        else resolve();
      };
      const onReady = () => done();
      const onError = () => done(new Error('The preview would not load.'));
      const timer = setTimeout(() => done(new Error('The preview took too long.')), timeoutMs);
      audio.addEventListener('canplaythrough', onReady);
      audio.addEventListener('error', onError);
      audio.pause();
      audio.src = url;
      audio.load();
    });
  }

  /**
   * Bring the cued song up and let the old one fall away under it. Resolves
   * when sound is actually coming out.
   */
  async start(options: StartOptions = {}): Promise<void> {
    this.playlistRun++;
    await this.swap(options);
  }

  private async swap({ offset = 0, loop = false, volume = 1, fadeIn = 0, fadeOutOld = 0.4 }: StartOptions) {
    const next = this.idle;
    const old = this.decks[this.live];
    next.audio.loop = loop;
    next.volume = volume;
    if (offset > 0) next.audio.currentTime = offset;
    this.ramp(next, 0, 0);
    this.live = 1 - this.live;
    if (this.held) {
      this.resumeOnRelease = true; // It starts when the game does.
      return;
    }
    await next.audio.play();
    this.ramp(next, volume, fadeIn);
    this.ramp(old, 0, fadeOutOld);
    // Pause the old deck once it is silent, unless it has been reused by then.
    const loads = old.loads;
    setTimeout(() => loads === old.loads && old.audio.pause(), fadeOutOld * 1000 + 60);
  }

  /**
   * Start the song the room is hearing over from `offset` seconds, for a
   * round that plays its clip more than once: a quick dip out over `dip`
   * seconds, the jump, and back up as fast. Call it `dip` seconds early and
   * the jump lands on time. While paused it only moves the place, so the
   * song resumes from there.
   */
  async replay(offset = 0, dip = 0.3): Promise<void> {
    const deck = this.decks[this.live];
    if (!deck.audio.src || (deck.audio.paused && !this.held)) return;
    const loads = deck.loads;
    if (!this.held) {
      this.ramp(deck, 0, dip);
      await wait(dip * 1000);
    }
    // Another song took over meanwhile: leave it alone.
    if (loads !== deck.loads || this.decks[this.live] !== deck) return;
    deck.audio.currentTime = offset;
    if (!this.held) this.ramp(deck, deck.volume, dip);
  }

  /** Let the music fall away. Resolves when it is silent. */
  async fadeOut(seconds: number): Promise<void> {
    this.playlistRun++;
    const deck = this.decks[this.live];
    if (deck.audio.paused) return;
    const loads = deck.loads;
    this.ramp(deck, 0, seconds);
    await wait(seconds * 1000 + 60);
    if (loads === deck.loads && !this.held) deck.audio.pause();
  }

  /**
   * Play `urls` in order, forever, each song crossfading into the next a few
   * seconds before it ends. Any other call to cue, start or fadeOut ends it.
   */
  async playlist(urls: string[], volume: number, crossfade: number): Promise<void> {
    if (urls.length === 0) return;
    const run = ++this.playlistRun;
    const stopped = () => run !== this.playlistRun;
    for (let i = 0; ; i = (i + 1) % urls.length) {
      try {
        await this.load(urls[i]);
      } catch {
        if (stopped() || urls.length === 1) return;
        continue;
      }
      if (stopped()) return;
      // Hold the next song until this one is nearly over.
      const playing = this.decks[this.live].audio;
      while (!stopped() && !playing.paused && playing.duration - playing.currentTime > crossfade + 0.25) {
        await wait(200);
      }
      if (stopped()) return;
      await this.swap({ volume, fadeIn: crossfade, fadeOutOld: crossfade });
      // The deck that just faded out is the one the next song loads onto.
      await wait(crossfade * 1000 + 120);
      if (stopped()) return;
    }
  }

  /**
   * The game is paused: lift the music out, keeping its place, and leave the
   * needle in the run-out groove: a soft crackle and a thump once a turn.
   */
  hold(): void {
    if (this.held) return;
    this.held = true;
    const deck = this.decks[this.live];
    // A song that had already faded out stays out when the game resumes.
    this.resumeOnRelease = !deck.audio.paused;
    this.ramp(deck, 0, 0.35);
    const loads = deck.loads;
    setTimeout(() => this.held && loads === deck.loads && deck.audio.pause(), 400);
    this.startRunout();
  }

  /**
   * Pick the music up where it stopped. With `resume` false the game it held
   * is over: the needle lifts and the song stays stopped, so whatever plays
   * next starts from silence instead of crossfading out of it.
   */
  release(resume = true): void {
    if (!this.held) return;
    this.held = false;
    this.stopRunout();
    const deck = this.decks[this.live];
    if (!resume) {
      this.ramp(deck, 0, 0);
      deck.audio.pause();
      return;
    }
    if (!this.resumeOnRelease || !deck.audio.src || deck.audio.ended) return;
    void deck.audio.play().then(
      () => this.ramp(deck, deck.volume, 0.5),
      () => {},
    );
  }

  private startRunout(): void {
    const context = this.context;
    if (!context || !this.analyser || this.runout) return;
    // One turn of a 33⅓ rpm record is 1.8 s: surface noise, a scatter of
    // clicks, and the thump of the needle crossing the lead-out.
    const seconds = 1.8;
    const buffer = context.createBuffer(1, Math.floor(context.sampleRate * seconds), context.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * 0.012;
    for (let click = 0; click < 22; click++) {
      const at = Math.floor(Math.random() * (data.length - 40));
      const size = 0.15 + Math.random() * 0.5;
      for (let j = 0; j < 30; j++) data[at + j] += (Math.random() * 2 - 1) * size * Math.exp(-j / 6);
    }
    for (let j = 0; j < 2600; j++) {
      data[j] += Math.sin((j / context.sampleRate) * 2 * Math.PI * 58) * 0.55 * Math.exp(-j / 700);
    }
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    const gain = context.createGain();
    gain.gain.setValueAtTime(0, context.currentTime);
    gain.gain.linearRampToValueAtTime(0.5, context.currentTime + 0.8);
    source.connect(gain).connect(this.analyser);
    source.start();
    this.runout = { source, gain };
  }

  private stopRunout(): void {
    const runout = this.runout;
    if (!runout || !this.context) return;
    this.runout = null;
    const now = this.context.currentTime;
    runout.gain.gain.cancelScheduledValues(now);
    runout.gain.gain.setValueAtTime(runout.gain.gain.value, now);
    runout.gain.gain.linearRampToValueAtTime(0, now + 0.3);
    runout.source.stop(now + 0.35);
  }

  /** Warm the browser cache with a preview that will be wanted soon. */
  prefetch(url: string): void {
    if (this.prefetcher?.src === url) return;
    this.prefetcher = new Audio();
    this.prefetcher.crossOrigin = 'anonymous';
    this.prefetcher.preload = 'auto';
    this.prefetcher.src = url;
  }

  /** Current spectrum, 0–255 per bin; null until unlocked. */
  readSpectrum(): Uint8Array | null {
    if (!this.analyser || !this.spectrum) return null;
    this.analyser.getByteFrequencyData(this.spectrum);
    return this.spectrum;
  }

  /**
   * The sound check: a short chime through the same graph as every song, with
   * whatever is playing ducked under it and brought back after. Resolves when
   * the chime has rung out. Call after `unlock`.
   */
  async chime(): Promise<void> {
    const context = this.context;
    const music = this.music;
    if (!context || !this.analyser || !music) throw new Error('Sound is not on yet.');
    if (!this.chimer) {
      this.chimer = new Audio(chimeClip());
      context.createMediaElementSource(this.chimer).connect(this.analyser);
    }
    const audio = this.chimer;
    const duck = (to: number, seconds: number) => {
      const now = context.currentTime;
      music.gain.cancelScheduledValues(now);
      music.gain.setValueAtTime(music.gain.value, now);
      music.gain.linearRampToValueAtTime(to, now + seconds);
    };
    // Lobby music, or a song starting meanwhile, sits under the chime.
    duck(0.15, 0.25);
    try {
      audio.pause();
      audio.currentTime = 0;
      await audio.play();
      await new Promise<void>((resolve) => {
        const done = () => {
          clearTimeout(timer);
          audio.removeEventListener('ended', done);
          resolve();
        };
        const timer = setTimeout(done, 4000);
        audio.addEventListener('ended', done);
      });
    } finally {
      duck(1, 0.8);
    }
  }

  stop(): void {
    this.playlistRun++;
    this.stopRunout();
    for (const deck of this.decks) deck.audio.pause();
  }
}

let shared: Jukebox | null = null;

/**
 * One jukebox per tab. "Host a game" on the landing page unlocks it with its
 * click; the host screen, reached without a page load, inherits it unlocked,
 * so a game started from a phone can play straight away.
 */
export function getJukebox(): Jukebox {
  shared ??= new Jukebox();
  return shared;
}
