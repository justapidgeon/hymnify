/**
 * Hymnify — main application
 */
(function () {
  'use strict';

  const KEYS = ['A', 'Bb', 'B', 'C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab'];
  const SCALES = {
    A: ['A', 'B', 'C#', 'D', 'E', 'F#', 'G', 'G#'],
    Bb: ['Bb', 'C', 'D', 'Eb', 'F', 'G', 'Ab', 'A'],
    B: ['B', 'C#', 'D#', 'E', 'F#', 'G#', 'A', 'A#'],
    C: ['C', 'D', 'E', 'F', 'G', 'A', 'Bb', 'B'],
    Db: ['Db', 'Eb', 'F', 'Gb', 'Ab', 'Bb', 'B', 'C'],
    D: ['D', 'E', 'F#', 'G', 'A', 'B', 'C', 'C#'],
    Eb: ['Eb', 'F', 'G', 'Ab', 'Bb', 'C', 'Db', 'D'],
    E: ['E', 'F#', 'G#', 'A', 'B', 'C#', 'D', 'D#'],
    F: ['F', 'G', 'A', 'Bb', 'C', 'D', 'Eb', 'E'],
    Gb: ['Gb', 'Ab', 'Bb', 'Cb', 'Db', 'Eb', 'E', 'F'],
    G: ['G', 'A', 'B', 'C', 'D', 'E', 'F', 'F#'],
    Ab: ['Ab', 'Bb', 'C', 'Db', 'Eb', 'F', 'Gb', 'G']
  };
  const GUESS_SHARPS = ['A', 'A#', 'B', 'C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#'];
  const GUESS_FLATS = ['A', 'Bb', 'B', 'C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab'];
  const KEY_SHARPNESS = {
    A: 'sharp', Bb: 'flat', B: 'sharp', C: 'sharp', Db: 'flat', D: 'sharp',
    Eb: 'flat', E: 'sharp', F: 'flat', Gb: 'flat', G: 'sharp', Ab: 'flat'
  };

  const NOTE_FREQ = {
    C: 261.63, 'C#': 277.18, Db: 277.18, D: 293.66, 'D#': 311.13, Eb: 311.13,
    E: 329.63, F: 349.23, 'F#': 369.99, Gb: 369.99, G: 392.0, 'G#': 415.3,
    Ab: 415.3, A: 440.0, 'A#': 466.16, Bb: 466.16, B: 493.88
  };

  const PAGE_SIZE = 150;

  // Pre-built search index: array of { id, title_lc, author_lc, number_str, lyrics_lc }
  // Built once when hymns load. Chord brackets are stripped from lyrics so "[G]"
  // never creates false positives.
  let searchIndex = [];
  let searchIndexMap = new Map(); // id → index entry, rebuilt with searchIndex

  function buildSearchIndex(hymns) {
    searchIndex = hymns.map((h) => ({
      id: h.id,
      title_lc: h.title ? h.title.toLowerCase() : '',
      author_lc: h.author ? h.author.toLowerCase() : '',
      number_str: h.number != null ? String(h.number) : '',
      lyrics_lc: h.lyrics ? h.lyrics.replace(/\[[^\]]*\]/g, '').toLowerCase() : ''
    }));
    // Build the map once here — never rebuild it during filtering
    searchIndexMap = new Map(searchIndex.map((e) => [e.id, e]));
  }

  const state = {
    hymns: [],
    searchQuery: '',
    activeTab: 'all',
    likedIds: loadJson('hymnify_liked', []),
    recentSearches: loadJson('hymnify_recent_searches', []),
    flaggedSongs: loadJson('hymnify_flagged', {}), // { songId: { note, flaggedAt } }
    currentSong: null,
    selectedTune: 0,
    transpose: 0,
    fontSize: 24,
    showChords: true,
    // 'full' = chords for entire song, 'intro' = chords only on first verse + first chorus
    chordScope: loadJson('hymnify_chord_scope', 'full'),
    autoScrolling: false,
    listOffset: PAGE_SIZE,
    filteredHymns: []
  };

  let scrollTimer = null;
  let audioCtx = null;
  let searchDebounce = null;

  const el = {
    loadingOverlay: document.getElementById('loadingOverlay'),
    loadingMessage: document.getElementById('loadingMessage'),
    loadingBar: document.getElementById('loadingBar'),
    syncStatus: document.getElementById('syncStatus'),
    searchInput: document.getElementById('searchInput'),
    recentSearchesWrapper: document.getElementById('recentSearchesWrapper'),
    recentChipsContainer: document.getElementById('recentChipsContainer'),
    tabAll: document.getElementById('tabAll'),
    tabLiked: document.getElementById('tabLiked'),
    hymnsGrid: document.getElementById('hymnsGrid'),
    readerView: document.getElementById('readerView'),
    readerBackBtn: document.getElementById('readerBackBtn'),
    readerSongTitle: document.getElementById('readerSongTitle'),
    readerSongMeta: document.getElementById('readerSongMeta'),
    readerLikeBtn: document.getElementById('readerLikeBtn'),
    readerContent: document.getElementById('readerContent'),
    transposeMinus: document.getElementById('transposeMinus'),
    transposePlus: document.getElementById('transposePlus'),
    keyDisplay: document.getElementById('keyDisplay'),
    fontMinus: document.getElementById('fontMinus'),
    fontPlus: document.getElementById('fontPlus'),
    scrollToggleBtn: document.getElementById('scrollToggleBtn'),
    toggleChordsBtn: document.getElementById('toggleChordsBtn'),
    chordScopeBtn: document.getElementById('chordScopeBtn'),
    pitchPipeBtn: document.getElementById('pitchPipeBtn'),
    flagSongBtn: document.getElementById('flagSongBtn'),
    themeToggleBtn: document.getElementById('themeToggleBtn'),
    openRequestBtn: document.getElementById('openRequestBtn'),
    requestModal: document.getElementById('requestModal'),
    closeRequestModalBtn: document.getElementById('closeRequestModalBtn'),
    cancelRequestBtn: document.getElementById('cancelRequestBtn'),
    songRequestForm: document.getElementById('songRequestForm'),
    flagModal: document.getElementById('flagModal'),
    closeFlagModalBtn: document.getElementById('closeFlagModalBtn'),
    flagNoteInput: document.getElementById('flagNoteInput'),
    flagSongForm: document.getElementById('flagSongForm'),
    toastNotification: document.getElementById('toastNotification'),
    toastMessage: document.getElementById('toastMessage')
  };

  function mod(n, m) {
    return ((n % m) + m) % m;
  }

  function loadJson(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch {
      return fallback;
    }
  }

  function saveJson(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function showLoading(show) {
    if (el.loadingOverlay) {
      el.loadingOverlay.style.display = show ? 'flex' : 'none';
    }
  }

  function updateLoadingProgress({ message, percent }) {
    if (el.loadingMessage) el.loadingMessage.textContent = message;
    if (el.loadingBar) el.loadingBar.style.width = `${percent}%`;
  }

  function updateSyncStatus(text) {
    if (el.syncStatus) el.syncStatus.textContent = text;
  }

  function showToast(message) {
    el.toastMessage.textContent = message;
    el.toastNotification.style.display = 'block';
    setTimeout(() => {
      el.toastNotification.style.display = 'none';
    }, 2800);
  }

  function getFilteredHymns() {
    let list = state.activeTab === 'liked'
      ? state.hymns.filter((h) => state.likedIds.includes(h.id))
      : state.hymns.slice();

    const q = state.searchQuery.trim().toLowerCase();
    if (q) {
      // Use the pre-built map — no allocation on every keystroke
      list = list.filter((h) => {
        const idx = searchIndexMap.get(h.id);
        if (!idx) return false;
        return (
          idx.number_str.includes(q) ||
          idx.title_lc.includes(q) ||
          idx.author_lc.includes(q) ||
          idx.lyrics_lc.includes(q)
        );
      });
    } else if (state.activeTab === 'all') {
      const numbered = list.filter((h) => h.number != null);
      const unnumbered = list.filter((h) => h.number == null);
      numbered.sort((a, b) => a.number - b.number);
      unnumbered.sort((a, b) => a.title.localeCompare(b.title));
      list = numbered.concat(unnumbered);
    } else {
      list.sort((a, b) => a.title.localeCompare(b.title));
    }

    return list;
  }

  function renderHymnsGrid() {
    state.filteredHymns = getFilteredHymns();
    const total = state.filteredHymns.length;
    const limit = state.searchQuery.trim() ? total : Math.min(state.listOffset, total);
    const visible = state.filteredHymns.slice(0, limit);

    if (total === 0) {
      el.hymnsGrid.innerHTML = `
        <div class="empty-state glass-panel">
          <svg class="empty-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
          </svg>
          <p>${state.activeTab === 'liked' ? 'No liked songs yet. Tap the heart on any hymn!' : 'No hymns found. Try a different search.'}</p>
        </div>`;
      return;
    }

    const likedSet = new Set(state.likedIds);
    const cardsHtml = visible.map((hymn) => {
      const liked = likedSet.has(hymn.id);
      const flagged = !!state.flaggedSongs[hymn.id];
      const badge = hymn.number != null ? hymn.number : '♪';
      const meta = hymn.number != null
        ? `#${hymn.number} • Key ${hymn.originalKey}`
        : `Key ${hymn.originalKey}`;

      return `
        <article class="hymn-card glass-panel" data-id="${hymn.id}">
          <div class="hymn-info">
            <div class="hymn-number-badge">${badge}</div>
            <div class="hymn-details">
              <div class="hymn-card-title">${escapeHtml(hymn.title)}${flagged ? ' <span class="flag-badge" title="Flagged for review"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" y1="22" x2="4" y2="15"/></svg></span>' : ''}</div>
              <div class="hymn-card-meta">${escapeHtml(meta)}</div>
            </div>
          </div>
          <div class="like-zone" data-like-id="${hymn.id}" title="Like this song">
            <button class="like-btn ${liked ? 'liked' : ''}" type="button" aria-label="Like">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>
              </svg>
            </button>
          </div>
        </article>`;
    }).join('');

    let footer = '';
    if (!state.searchQuery.trim() && limit < total) {
      footer = `
        <button id="loadMoreBtn" class="secondary-btn load-more-btn" type="button">
          Load more (${limit} of ${total.toLocaleString()})
        </button>`;
    } else if (total > 0) {
      footer = `<p class="results-count">${total.toLocaleString()} hymn${total === 1 ? '' : 's'}</p>`;
    }

    el.hymnsGrid.innerHTML = cardsHtml + footer;

    document.getElementById('loadMoreBtn')?.addEventListener('click', () => {
      state.listOffset += PAGE_SIZE;
      renderHymnsGrid();
    });
  }

  function renderRecentSearches() {
    if (state.recentSearches.length === 0) {
      el.recentSearchesWrapper.style.display = 'none';
      return;
    }

    el.recentSearchesWrapper.style.display = 'block';
    el.recentChipsContainer.innerHTML = state.recentSearches
      .map(
        (term) => `
        <span class="chip" data-term="${escapeHtml(term)}">
          ${escapeHtml(term)}
          <span class="chip-remove" data-remove="${escapeHtml(term)}">&times;</span>
        </span>`
      )
      .join('');
  }

  function addRecentSearch(term) {
    const cleaned = term.trim();
    if (!cleaned) return;
    state.recentSearches = [cleaned, ...state.recentSearches.filter((t) => t !== cleaned)].slice(0, 8);
    saveJson('hymnify_recent_searches', state.recentSearches);
    renderRecentSearches();
  }

  function toggleLike(id) {
    const nowLiked = !state.likedIds.includes(id);
    if (nowLiked) {
      state.likedIds.push(id);
    } else {
      state.likedIds = state.likedIds.filter((x) => x !== id);
    }
    saveJson('hymnify_liked', state.likedIds);

    // Patch only the affected card — no full re-render
    const zone = el.hymnsGrid.querySelector(`[data-like-id="${id}"]`);
    if (zone) {
      const btn = zone.querySelector('.like-btn');
      if (btn) btn.classList.toggle('liked', nowLiked);
    }

    // If we're in the liked tab and just unliked, remove the card from view
    if (state.activeTab === 'liked' && !nowLiked) {
      const card = el.hymnsGrid.querySelector(`[data-id="${id}"]`);
      card?.remove();
      // Update results count text
      const remaining = el.hymnsGrid.querySelectorAll('.hymn-card').length;
      if (remaining === 0) renderHymnsGrid(); // show empty state
    }

    if (state.currentSong?.id === id) {
      updateReaderLikeButton();
    }
  }

  function updateReaderLikeButton() {
    const liked = state.likedIds.includes(state.currentSong.id);
    el.readerLikeBtn.classList.toggle('liked', liked);
  }

  function updateReaderFlagButton() {
    if (!el.flagSongBtn || !state.currentSong) return;
    const flagged = !!state.flaggedSongs[state.currentSong.id];
    el.flagSongBtn.classList.toggle('flagged', flagged);
    el.flagSongBtn.title = flagged ? 'Song flagged — click to edit note' : 'Flag song / report chord error';
  }

  function openFlagModal() {
    if (!state.currentSong) return;
    const existing = state.flaggedSongs[state.currentSong.id];
    el.flagNoteInput.value = existing ? existing.note : '';
    el.flagModal.style.display = 'flex';
    setTimeout(() => el.flagNoteInput.focus(), 80);
  }

  function closeFlagModal() {
    el.flagModal.style.display = 'none';
  }

  function submitFlagReport(note) {
    if (!state.currentSong) return;
    const id = state.currentSong.id;
    if (note.trim()) {
      state.flaggedSongs[id] = {
        songId: id,
        title: state.currentSong.title,
        note: note.trim(),
        flaggedAt: new Date().toISOString()
      };
    } else {
      // Empty note = unflag
      delete state.flaggedSongs[id];
    }
    saveJson('hymnify_flagged', state.flaggedSongs);
    updateReaderFlagButton();

    // Patch only the affected card's title — no full re-render
    const titleEl = el.hymnsGrid.querySelector(`[data-id="${id}"] .hymn-card-title`);
    if (titleEl) {
      const badge = titleEl.querySelector('.flag-badge');
      if (note.trim() && !badge) {
        // add badge
        const span = document.createElement('span');
        span.className = 'flag-badge';
        span.title = 'Flagged for review';
        span.innerHTML = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" y1="22" x2="4" y2="15"/></svg>';
        titleEl.appendChild(span);
      } else if (!note.trim() && badge) {
        badge.remove();
      }
    }

    closeFlagModal();
    showToast(note.trim() ? 'Flag submitted — thank you!' : 'Flag removed.');
  }

  function getLyricTunes(lyrics) {
    if (!lyrics) return [''];
    return lyrics.split(/(?=###)/).filter((s) => s.length > 0);
  }

  function getActiveLyrics(song) {
    const tunes = getLyricTunes(song.lyrics);
    const idx = Math.min(state.selectedTune, tunes.length - 1);
    return tunes[idx].replace(/###.*\n?/, '');
  }

  function getNewKey(originalKey, transposeValue) {
    const idx = KEYS.indexOf(originalKey);
    if (idx === -1) return originalKey;
    return KEYS[mod(idx + transposeValue, 12)];
  }

  function transposeChord(chord, originalKey, transposeValue) {
    if (!transposeValue) return chord;

    const newKey = getNewKey(originalKey, transposeValue);
    const regex = /([A-G][b#]?)([^A-G]*)/g;

    return chord.replace(regex, (_match, chordCore, trailingChars) => {
      let transposedCore;
      try {
        transposedCore = SCALES[newKey][SCALES[originalKey].indexOf(chordCore)];
      } catch {
        transposedCore = false;
      }

      if (transposedCore) {
        return transposedCore + trailingChars;
      }

      const movement = mod(transposeValue, 12);
      const flatIdx = GUESS_FLATS.indexOf(chordCore);
      const sharpIdx = GUESS_SHARPS.indexOf(chordCore);
      const chordCoreIndex = Math.max(flatIdx, sharpIdx);
      const newIndex = mod(chordCoreIndex + movement, 12);
      const newChordCore =
        KEY_SHARPNESS[newKey] === 'sharp' ? GUESS_SHARPS[newIndex] : GUESS_FLATS[newIndex];
      return newChordCore + trailingChars;
    });
  }

  // Returns true if the song has chord annotations beyond just the first
  // verse + first chorus (i.e. "All Chords" mode would actually show more).
  function songHasFullChords(lyrics) {
    if (!lyrics) return false;
    const lines = lyrics.split('\n');
    let verseCount = 0;
    let chorusCount = 0;
    let inFirstVerse = false;
    let inFirstChorus = false;
    let pastIntro = false;

    for (const line of lines) {
      const trimmed = line.trim();

      if (!trimmed) {
        inFirstVerse = false;
        inFirstChorus = false;
        continue;
      }

      const section = parseSectionHeader(line);
      if (section) {
        if (/^verse/i.test(section)) {
          verseCount++;
          inFirstVerse = verseCount === 1;
          inFirstChorus = false;
          if (verseCount > 1) pastIntro = true;
        } else if (/^chorus$/i.test(section)) {
          chorusCount++;
          inFirstChorus = chorusCount === 1;
          inFirstVerse = false;
          if (chorusCount > 1) pastIntro = true;
        } else {
          // Bridge, Tag, etc. count as beyond intro
          pastIntro = true;
          inFirstVerse = false;
          inFirstChorus = false;
        }
        continue;
      }

      // If we're past the intro sections, check for any chord bracket
      if (pastIntro || (!inFirstVerse && !inFirstChorus)) {
        if (/\[[A-G][^\]]*\]/.test(line)) return true;
      }
    }
    return false;
  }

  function normalizeSectionLabel(raw) {
    const text = raw.trim();
    if (/^chorus/i.test(text)) return 'Chorus';
    if (/^bridge/i.test(text)) return 'Bridge';
    if (/^tag/i.test(text)) return 'Tag';
    if (/^verse/i.test(text)) {
      const num = text.match(/\d+/);
      return num ? `Verse ${num[0]}` : 'Verse';
    }
    return text;
  }

  function parseSectionHeader(line) {
    const trimmed = line.trim();

    let match = trimmed.match(/^#\s*\[(Verse\s*\d*|Chorus|Bridge|Tag[^\]]*)\]\s*$/i);
    if (match) return normalizeSectionLabel(match[1]);

    match = trimmed.match(/^#\s*(Verse\s*\d*|Chorus|Bridge|Tag)\s*$/i);
    if (match) return normalizeSectionLabel(match[1]);

    match = trimmed.match(/^\[(Verse\s*\d*|Chorus|Bridge|Tag[^\]]*)\]\s*$/i);
    if (match) return normalizeSectionLabel(match[1]);

    if (/^\d+$/.test(trimmed)) return `Verse ${trimmed}`;

    return null;
  }

  function parseChordSegments(line) {
    const parts = line.split(/(\[[^\]]*\])/g).filter(Boolean);
    const segments = [];
    let pendingChord = null;

    parts.forEach((part) => {
      const chordMatch = part.match(/^\[(.*)\]$/);
      if (chordMatch) {
        pendingChord = chordMatch[1];
        return;
      }

      segments.push({ chord: pendingChord ?? '', text: part });
      pendingChord = null;
    });

    if (pendingChord !== null) {
      segments.push({ chord: pendingChord, text: '' });
    }

    return segments;
  }

  function renderChordLine(segments, originalKey, isChorus, scopeHideChords) {
    const hasChords = segments.some((segment) => segment.chord);

    if (!hasChords) {
      const text = segments.map((segment) => segment.text).join('');
      return `<div class="lyric-line-wrap${isChorus ? ' chorus-line' : ''}"><div class="lyric-plain-row"><span class="lyric-below">${escapeHtml(text)}</span></div></div>`;
    }

    // When chords are hidden via scope, render as plain row
    const showThisLineChords = state.showChords && !scopeHideChords;

    const cells = segments.map(({ chord, text }) => {
      const transposed =
        chord && showThisLineChords ? transposeChord(chord, originalKey, state.transpose) : '';
      const chordHtml = showThisLineChords
        ? `<span class="chord-above${transposed ? '' : ' chord-blank'}">${transposed ? escapeHtml(transposed) : '&nbsp;'}</span>`
        : '';

      return `<span class="chord-cell">${chordHtml ? `<span class="chord-slot">${chordHtml}</span>` : ''}<span class="lyric-below">${escapeHtml(text)}</span></span>`;
    }).join('');

    return `<div class="lyric-line-wrap${isChorus ? ' chorus-line' : ''}"><div class="chord-line-row">${cells}</div></div>`;
  }

  function parseLyricsToHtml(lyrics, originalKey) {
    const lines = lyrics.split('\n');
    const html = [];
    let chorusHeaderShown = false;
    let inChorusBlock = false;

    // Chord scope tracking: in 'intro' mode, only first verse + first chorus get chords
    const introMode = state.chordScope === 'intro';
    let firstVerseRendered = false;
    let firstChorusRendered = false;
    let inFirstVerse = false;
    let inFirstChorus = false;

    lines.forEach((line) => {
      const trimmed = line.trim();

      if (!trimmed) {
        html.push('<div class="lyric-spacer"></div>');
        chorusHeaderShown = false;
        inChorusBlock = false;
        // In intro mode, once we leave a section, lock it
        if (introMode) {
          if (inFirstVerse) firstVerseRendered = true;
          if (inFirstChorus) firstChorusRendered = true;
          inFirstVerse = false;
          inFirstChorus = false;
        }
        return;
      }

      const section = parseSectionHeader(line);
      if (section) {
        html.push(`<div class="section-tag">${escapeHtml(section)}</div>`);
        inChorusBlock = /^chorus$/i.test(section);
        chorusHeaderShown = inChorusBlock;

        if (introMode) {
          if (/^verse/i.test(section)) {
            inFirstChorus = false;
            if (!firstVerseRendered) {
              inFirstVerse = true;
            } else {
              inFirstVerse = false;
            }
          } else if (/^chorus$/i.test(section)) {
            inFirstVerse = false;
            if (!firstChorusRendered) {
              inFirstChorus = true;
            } else {
              inFirstChorus = false;
            }
          } else {
            inFirstVerse = false;
            inFirstChorus = false;
          }
        }
        return;
      }

      if (/^<[^>]+>$/.test(trimmed)) {
        return;
      }

      if (/^#\s+/.test(trimmed) && !/^#\s*\[?(verse|chorus|bridge|tag)/i.test(trimmed)) {
        const comment = trimmed.replace(/^#\s*/, '');
        if (html.length === 0) {
          html.push(`<div class="song-comment-title">${escapeHtml(comment)}</div>`);
        } else {
          html.push(`<div class="lyric-comment">${escapeHtml(comment)}</div>`);
        }
        return;
      }

      const isChorusLine = line.startsWith('  ');
      if (isChorusLine && !chorusHeaderShown) {
        html.push('<div class="section-tag">Chorus</div>');
        chorusHeaderShown = true;
        inChorusBlock = true;
        if (introMode && !firstChorusRendered) {
          inFirstChorus = true;
        }
      }

      // Determine whether to suppress chords for this line in intro mode
      let scopeHideChords = false;
      if (introMode) {
        const inActiveSection = inFirstVerse || inFirstChorus || isChorusLine && !firstChorusRendered;
        scopeHideChords = !inActiveSection;
      }

      const content = isChorusLine ? line.replace(/^  /, '') : line;
      const segments = parseChordSegments(content);
      if (segments.length === 0) return;

      html.push(renderChordLine(segments, originalKey, inChorusBlock || isChorusLine, scopeHideChords));
    });

    return html.join('');
  }

  function renderReaderContent() {
    if (!state.currentSong) return;

    const lyrics = getActiveLyrics(state.currentSong);
    const originalKey = state.currentSong.originalKey || 'C';
    const displayKey = getNewKey(originalKey, state.transpose);

    el.keyDisplay.textContent = displayKey;
    el.readerContent.classList.toggle('hide-chords', !state.showChords);
    el.readerContent.style.setProperty('--lyric-size', `${state.fontSize}px`);

    // Sync chord scope button — grey it out if song has no chords beyond the intro
    if (el.chordScopeBtn) {
      const isIntro = state.chordScope === 'intro';
      const hasFullChords = songHasFullChords(state.currentSong.lyrics);
      el.chordScopeBtn.textContent = isIntro ? 'Intro Chords' : 'All Chords';
      el.chordScopeBtn.classList.toggle('scope-intro', isIntro);
      el.chordScopeBtn.disabled = !hasFullChords;
      el.chordScopeBtn.classList.toggle('scope-disabled', !hasFullChords);
      el.chordScopeBtn.title = !hasFullChords
        ? 'This song only has chords for the intro'
        : isIntro
          ? 'Showing chords on first verse & chorus only — click to show all'
          : 'Toggle between chords for the full song or just the first verse & chorus';
    }

    const tunes = getLyricTunes(state.currentSong.lyrics);
    let tuneSelector = '';
    if (tunes.length > 1) {
      tuneSelector = `
        <div class="tune-selector-wrap">
          <label for="tuneSelect">Tune</label>
          <select id="tuneSelect" class="tune-select-input">
            ${tunes
              .map((tune, i) => {
                const titleMatch = tune.match(/### (.*)/);
                const label = titleMatch ? titleMatch[1] : `Tune ${i + 1}`;
                return `<option value="${i}" ${i === state.selectedTune ? 'selected' : ''}>${escapeHtml(label)}</option>`;
              })
              .join('')}
          </select>
        </div>`;
    }

    const body = parseLyricsToHtml(lyrics, originalKey);

    el.readerContent.innerHTML = tuneSelector + body;

    document.getElementById('tuneSelect')?.addEventListener('change', (e) => {
      state.selectedTune = Number(e.target.value);
      state.transpose = 0;
      renderReaderContent();
    });
  }

  function openReader(song) {
    state.currentSong = song;
    state.selectedTune = 0;
    state.transpose = 0;

    el.readerSongTitle.textContent = song.title;
    const metaParts = [];
    if (song.number != null) metaParts.push(`#${song.number}`);
    metaParts.push(`Key ${song.originalKey}`);
    if (song.author) metaParts.push(song.author);
    el.readerSongMeta.textContent = metaParts.join(' • ');

    updateReaderLikeButton();
    updateReaderFlagButton();
    renderReaderContent();

    el.readerView.classList.add('active');
    document.body.style.overflow = 'hidden';
    el.readerContent.scrollTop = 0;
  }

  function closeReader() {
    stopAutoScroll();
    el.readerView.classList.remove('active');
    document.body.style.overflow = '';
    state.currentSong = null;
  }

  function stopAutoScroll() {
    state.autoScrolling = false;
    el.scrollToggleBtn.classList.remove('active');
    if (scrollTimer) {
      cancelAnimationFrame(scrollTimer);
      scrollTimer = null;
    }
  }

  function toggleAutoScroll() {
    if (state.autoScrolling) {
      stopAutoScroll();
      return;
    }

    state.autoScrolling = true;
    el.scrollToggleBtn.classList.add('active');

    // rAF-based scroll: ~0.5px per frame at 60fps ≈ 30px/s, feels natural
    // Accumulate fractional pixels to keep motion smooth at any refresh rate
    let lastTime = null;
    let accumulator = 0;
    const PX_PER_MS = 0.012; // tune this to adjust speed

    function step(timestamp) {
      if (!state.autoScrolling) return;
      if (lastTime !== null) {
        accumulator += (timestamp - lastTime) * PX_PER_MS;
        if (accumulator >= 1) {
          const pixels = Math.floor(accumulator);
          accumulator -= pixels;
          el.readerContent.scrollTop += pixels;
        }
      }
      lastTime = timestamp;
      // Check stop condition — read scrollHeight only once per frame
      const { scrollTop, clientHeight, scrollHeight } = el.readerContent;
      if (scrollTop + clientHeight >= scrollHeight - 2) {
        stopAutoScroll();
        return;
      }
      scrollTimer = requestAnimationFrame(step);
    }
    scrollTimer = requestAnimationFrame(step);
  }

  function playPitchPipe() {
    if (!state.currentSong) return;
    const originalKey = state.currentSong.originalKey || 'C';
    const key = getNewKey(originalKey, state.transpose);
    const freq = NOTE_FREQ[key] || NOTE_FREQ.C;

    if (!audioCtx) {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }

    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = 'sine';
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.0001, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.25, audioCtx.currentTime + 0.05);
    gain.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + 1.2);
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start();
    osc.stop(audioCtx.currentTime + 1.25);
  }

  function setTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('hymnify_theme', theme);
    document.querySelector('.sun-icon').style.display = theme === 'dark' ? 'none' : 'block';
    document.querySelector('.moon-icon').style.display = theme === 'dark' ? 'block' : 'none';
  }

  function bindEvents() {
    el.searchInput.addEventListener('input', () => {
      clearTimeout(searchDebounce);
      searchDebounce = setTimeout(() => {
        state.searchQuery = el.searchInput.value;
        state.listOffset = PAGE_SIZE;
        renderHymnsGrid();
      }, 180);
    });

    el.searchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && state.searchQuery.trim()) {
        addRecentSearch(state.searchQuery.trim());
      }
    });

    el.recentChipsContainer.addEventListener('click', (e) => {
      const remove = e.target.closest('[data-remove]');
      if (remove) {
        const term = remove.dataset.remove;
        state.recentSearches = state.recentSearches.filter((t) => t !== term);
        saveJson('hymnify_recent_searches', state.recentSearches);
        renderRecentSearches();
        return;
      }
      const chip = e.target.closest('[data-term]');
      if (chip) {
        el.searchInput.value = chip.dataset.term;
        state.searchQuery = chip.dataset.term;
        state.listOffset = PAGE_SIZE;
        renderHymnsGrid();
      }
    });

    el.tabAll.addEventListener('click', () => {
      state.activeTab = 'all';
      el.tabAll.classList.add('active');
      el.tabLiked.classList.remove('active');
      state.listOffset = PAGE_SIZE;
      renderHymnsGrid();
    });

    el.tabLiked.addEventListener('click', () => {
      state.activeTab = 'liked';
      el.tabLiked.classList.add('active');
      el.tabAll.classList.remove('active');
      state.listOffset = PAGE_SIZE;
      renderHymnsGrid();
    });

    el.hymnsGrid.addEventListener('click', (e) => {
      const likeZone = e.target.closest('[data-like-id]');
      if (likeZone) {
        e.stopPropagation();
        toggleLike(likeZone.dataset.likeId);
        return;
      }

      const card = e.target.closest('[data-id]');
      if (card) {
        const song = state.hymns.find((h) => h.id === card.dataset.id);
        if (song) openReader(song);
      }
    });

    el.readerBackBtn.addEventListener('click', closeReader);
    el.readerLikeBtn.addEventListener('click', () => {
      if (state.currentSong) toggleLike(state.currentSong.id);
    });

    el.transposeMinus.addEventListener('click', () => {
      state.transpose -= 1;
      renderReaderContent();
    });

    el.transposePlus.addEventListener('click', () => {
      state.transpose += 1;
      renderReaderContent();
    });

    el.fontMinus.addEventListener('click', () => {
      state.fontSize = Math.max(16, state.fontSize - 2);
      renderReaderContent();
    });

    el.fontPlus.addEventListener('click', () => {
      state.fontSize = Math.min(36, state.fontSize + 2);
      renderReaderContent();
    });

    el.scrollToggleBtn.addEventListener('click', toggleAutoScroll);
    el.pitchPipeBtn.addEventListener('click', playPitchPipe);

    el.toggleChordsBtn.addEventListener('click', () => {
      state.showChords = !state.showChords;
      el.toggleChordsBtn.classList.toggle('active', state.showChords);
      renderReaderContent();
    });

    el.chordScopeBtn.addEventListener('click', () => {
      state.chordScope = state.chordScope === 'full' ? 'intro' : 'full';
      saveJson('hymnify_chord_scope', state.chordScope);
      renderReaderContent();
    });

    el.flagSongBtn.addEventListener('click', openFlagModal);

    el.closeFlagModalBtn.addEventListener('click', closeFlagModal);

    el.flagModal.addEventListener('click', (e) => {
      if (e.target === el.flagModal) closeFlagModal();
    });

    el.flagSongForm.addEventListener('submit', (e) => {
      e.preventDefault();
      submitFlagReport(el.flagNoteInput.value);
    });

    el.themeToggleBtn.addEventListener('click', () => {
      const current = document.documentElement.getAttribute('data-theme') || 'dark';
      setTheme(current === 'dark' ? 'light' : 'dark');
    });

    el.openRequestBtn.addEventListener('click', () => {
      el.requestModal.style.display = 'flex';
    });

    el.closeRequestModalBtn.addEventListener('click', () => {
      el.requestModal.style.display = 'none';
    });

    el.cancelRequestBtn.addEventListener('click', () => {
      el.requestModal.style.display = 'none';
    });

    el.requestModal.addEventListener('click', (e) => {
      if (e.target === el.requestModal) {
        el.requestModal.style.display = 'none';
      }
    });

    el.songRequestForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const request = {
        title: document.getElementById('reqSongTitle').value.trim(),
        number: document.getElementById('reqSongNumber').value.trim(),
        author: document.getElementById('reqSongAuthor').value.trim(),
        key: document.getElementById('reqSongKey').value.trim(),
        lyrics: document.getElementById('reqSongLyrics').value.trim(),
        submittedAt: new Date().toISOString()
      };

      const pending = loadJson('hymnify_pending_requests', []);
      pending.unshift(request);
      saveJson('hymnify_pending_requests', pending.slice(0, 50));

      el.songRequestForm.reset();
      el.requestModal.style.display = 'none';
      showToast('Song request saved — thank you!');
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && el.readerView.classList.contains('active')) {
        closeReader();
      }
    });
  }

  async function bootstrap() {
    bindEvents();
    renderRecentSearches();
    setTheme(localStorage.getItem('hymnify_theme') || 'dark');

    SongbaseSync.onProgress = ({ message, percent, showOverlay = true }) => {
      if (showOverlay) showLoading(true);
      updateLoadingProgress({ message, percent });
      if (!showOverlay && el.syncStatus) {
        el.syncStatus.textContent = message;
      }
    };
    SongbaseSync.onUpdate = ({ hymns, source }) => {
      state.hymns = hymns;
      buildSearchIndex(hymns);
      updateSyncStatus(`${hymns.length.toLocaleString()} songs from Songbase`);
      state.listOffset = PAGE_SIZE;
      renderHymnsGrid();

      if (source === 'full') {
        showLoading(false);
        showToast(`Loaded ${hymns.length.toLocaleString()} hymns!`);
      }
    };

    try {
      const hymns = await SongbaseSync.init({ language: 'english' });
      state.hymns = hymns;
      buildSearchIndex(hymns);
      updateSyncStatus(`${hymns.length.toLocaleString()} songs from Songbase`);
      renderHymnsGrid();
      showLoading(false);
    } catch (err) {
      console.error(err);
      showLoading(false);
      el.hymnsGrid.innerHTML = `
        <div class="empty-state glass-panel">
          <p>Could not load songs. Check your internet connection and refresh the page.</p>
          <button class="primary-btn retry-btn" type="button" onclick="location.reload()">Retry</button>
        </div>`;
      showToast('Failed to load Songbase library');
    }
  }

  bootstrap();
})();
