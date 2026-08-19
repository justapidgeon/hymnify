/**
 * Songbase API sync with IndexedDB caching (Option A).
 * Data source: https://songbase.life/api/v2
 */
(function () {
  'use strict';

  const API_BASE = '/api/songbase';
  const DB_NAME = 'hymnify-songbase';
  const DB_VERSION = 1;
  const DEFAULT_LANGUAGE = 'english';

  const KEYS = ['A', 'Bb', 'B', 'C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab'];
  const KEY_COMMON_CHORDS = {
    A: ['A', 'Bm', 'C#m', 'D', 'E', 'F#m'],
    Bb: ['Bb', 'Cm', 'Dm', 'Eb', 'F', 'Gm'],
    B: ['B', 'C#m', 'D#m', 'E', 'F#', 'G#m'],
    C: ['C', 'Dm', 'Em', 'F', 'G', 'Am'],
    Db: ['Db', 'Ebm', 'Fm', 'Gb', 'Ab', 'Bbm'],
    D: ['D', 'Em', 'F#m', 'G', 'A', 'Bm'],
    Eb: ['Eb', 'Fm', 'Gm', 'Ab', 'Bb', 'Cm'],
    E: ['E', 'F#m', 'G#m', 'A', 'B', 'C#m'],
    F: ['F', 'Gm', 'Am', 'Bb', 'C', 'Dm'],
    Gb: ['Gb', 'Abm', 'Bbm', 'Cb', 'Db', 'Ebm'],
    G: ['G', 'Am', 'Bm', 'C', 'D', 'Em'],
    Ab: ['Ab', 'Bbm', 'Cm', 'Db', 'Eb', 'Fm']
  };

  function mod(n, m) {
    return ((n % m) + m) % m;
  }

  function detectKeyFromLyrics(lyrics) {
    if (!lyrics || !/\[/.test(lyrics)) return 'C';

    const tuneLyrics = lyrics.split(/(?=###)/)[0].replace(/###.*\n/, '');
    const songChordsRegex = /\[([A-G][b#]?m?).*?\]/g;
    const songChords = Array.from(tuneLyrics.matchAll(songChordsRegex), (m) => m[1]);

    if (songChords.length === 0) return 'C';

    const lastChord = songChords[songChords.length - 1];
    if (songChords[0] === lastChord) {
      let key = lastChord;
      if (key.endsWith('m')) {
        const strippedKey = key.slice(0, -1);
        key = KEYS[mod(KEYS.indexOf(strippedKey) + 3, 12)];
      }
      return key;
    }

    const keysByChordCount = KEYS.map(
      (k) => songChords.filter((chord) => KEY_COMMON_CHORDS[k].includes(chord)).length
    );
    const bestMatch = Math.max(...keysByChordCount);
    return KEYS[keysByChordCount.indexOf(bestMatch)] || 'C';
  }

  function openDatabase() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        if (!db.objectStoreNames.contains('songs')) {
          db.createObjectStore('songs', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('books')) {
          db.createObjectStore('books', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('meta')) {
          db.createObjectStore('meta', { keyPath: 'key' });
        }
      };

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  function txStore(db, storeName, mode) {
    return db.transaction(storeName, mode).objectStore(storeName);
  }

  function getMeta(db) {
    return new Promise((resolve, reject) => {
      const request = txStore(db, 'meta', 'readonly').get('sync');
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
    });
  }

  function setMeta(db, meta) {
    return new Promise((resolve, reject) => {
      const tx = db.transaction('meta', 'readwrite');
      tx.objectStore('meta').put({ key: 'sync', ...meta });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  }

  function getAllSongsRaw(db) {
    return new Promise((resolve, reject) => {
      const request = txStore(db, 'songs', 'readonly').getAll();
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
    });
  }

  function getAllBooksRaw(db) {
    return new Promise((resolve, reject) => {
      const request = txStore(db, 'books', 'readonly').getAll();
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
    });
  }

  function saveSongs(db, songs) {
    return new Promise((resolve, reject) => {
      const tx = db.transaction('songs', 'readwrite');
      const store = tx.objectStore('songs');
      songs.forEach((song) => store.put(song));
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  }

  function deleteSongs(db, ids) {
    if (!ids || ids.length === 0) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('songs', 'readwrite');
      const store = tx.objectStore('songs');
      ids.forEach((id) => store.delete(Number(id)));
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  }

  function saveBooks(db, books) {
    return new Promise((resolve, reject) => {
      const tx = db.transaction('books', 'readwrite');
      const store = tx.objectStore('books');
      books.forEach((book) => store.put(book));
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  }

  // Atomically write songs + books + meta timestamp in one transaction so a
  // mid-write page close can never leave the DB in a state where songs exist
  // but meta is missing (which caused the full re-download loop).
  function saveFullSync(db, songs, books, metaPayload) {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(['songs', 'books', 'meta'], 'readwrite');
      const songStore = tx.objectStore('songs');
      const bookStore = tx.objectStore('books');
      const metaStore = tx.objectStore('meta');

      songs.forEach((song) => songStore.put(song));
      books.forEach((book) => bookStore.put(book));
      metaStore.put({ key: 'sync', ...metaPayload });

      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  }

  function buildNumberMap(books) {
    const map = new Map();
    books.forEach((book) => {
      if (!book.songs) return;
      Object.entries(book.songs).forEach(([num, songId]) => {
        const id = Number(songId);
        const number = Number(num);
        if (!map.has(id) || number < map.get(id)) {
          map.set(id, number);
        }
      });
    });
    return map;
  }

  function transformSongs(rawSongs, books) {
    const numberMap = buildNumberMap(books);
    return rawSongs.map((song) => ({
      id: `sb-${song.id}`,
      songbaseId: song.id,
      number: numberMap.get(song.id) || null,
      title: song.title,
      author: '',
      category: song.lang || DEFAULT_LANGUAGE,
      originalKey: detectKeyFromLyrics(song.lyrics),
      lyrics: song.lyrics,
      lang: song.lang || DEFAULT_LANGUAGE
    }));
  }

  async function fetchAppData(params) {
    const query = new URLSearchParams(params).toString();
    const url = `${API_BASE}/app_data${query ? `?${query}` : ''}`;
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Songbase API error: ${response.status}`);
    }
    return response.json();
  }

  const SongbaseSync = {
    db: null,
    hymns: [],
    onProgress: null,
    onUpdate: null,
    _syncPromise: null,   // in-flight guard — prevents concurrent downloads

    async init(options = {}) {
      const language = options.language || DEFAULT_LANGUAGE;
      this.db = await openDatabase();

      const cachedSongs = await getAllSongsRaw(this.db);
      const cachedBooks = await getAllBooksRaw(this.db);
      this.hadCache = cachedSongs.length > 0;

      if (cachedSongs.length > 0) {
        this.hymns = transformSongs(cachedSongs, cachedBooks);
        this._notifyUpdate('cache');
        // Background delta — don't stack if one is already running
        if (!this._syncPromise) {
          this._syncPromise = this.sync(language)
            .catch((err) => console.warn('Background sync failed:', err))
            .finally(() => { this._syncPromise = null; });
        }
        return this.hymns;
      }

      // No cache — full download. Guard against being called twice.
      if (!this._syncPromise) {
        this._syncPromise = this.sync(language, { initial: true })
          .finally(() => { this._syncPromise = null; });
      }
      return this._syncPromise;
    },

    async sync(language = DEFAULT_LANGUAGE, options = {}) {
      const isInitial = options.initial === true;
      const meta = await getMeta(this.db);
      const lastSync = meta?.updatedAt || 0;

      if (isInitial || !lastSync) {
        this._reportProgress('Downloading hymn library…', 0);
        const data = await fetchAppData({ language });
        this._reportProgress('Saving songs offline…', 70);

        // Single atomic write — songs + books + meta in one transaction.
        // If the page closes mid-write, nothing is partially committed.
        const metaPayload = {
          updatedAt: Date.now(),
          language,
          songCount: data.songs?.length || 0
        };
        await saveFullSync(
          this.db,
          data.songs || [],
          data.books || [],
          metaPayload
        );

        this.hymns = transformSongs(data.songs || [], data.books || []);
        this._reportProgress('Ready!', 100);
        this._notifyUpdate('full');
        return this.hymns;
      }

      this._reportProgress('Checking for updates…', 10, false);
      const delta = await fetchAppData({ updated_at: lastSync, language });

      if (delta.songs?.length) {
        await saveSongs(this.db, delta.songs);
      }
      if (delta.books?.length) {
        await saveBooks(this.db, delta.books);
      }
      if (delta.destroyed?.length) {
        await deleteSongs(this.db, delta.destroyed);
      }

      await setMeta(this.db, {
        updatedAt: Date.now(),
        language,
        songCount: (await getAllSongsRaw(this.db)).length
      });

      const allSongs = await getAllSongsRaw(this.db);
      const allBooks = await getAllBooksRaw(this.db);
      this.hymns = transformSongs(allSongs, allBooks);
      this._reportProgress('Up to date', 100, false);
      this._notifyUpdate('delta');
      return this.hymns;
    },

    getHymns() {
      return this.hymns;
    },

    getById(id) {
      return this.hymns.find((h) => h.id === id);
    },

    detectKeyFromLyrics,

    _reportProgress(message, percent, showOverlay = true) {
      if (typeof this.onProgress === 'function') {
        this.onProgress({ message, percent, showOverlay });
      }
    },

    _notifyUpdate(source) {
      if (typeof this.onUpdate === 'function') {
        this.onUpdate({ hymns: this.hymns, source });
      }
    }
  };

  window.SongbaseSync = SongbaseSync;
})();
