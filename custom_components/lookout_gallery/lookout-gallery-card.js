/**
 * Lookout Gallery Card v1.0.0
 * Created by MrMarv89
 * 
 * Description:
 * A high-performance media gallery for Home Assistant with server-side thumbnail generation.
 * 
 * Features:
 * - Server-side thumbnail generation using ffmpeg
 * - Fast loading on all devices (mobile, tablet, PC)
 * - IndexedDB caching for offline use
 * - Smart filtering of broken/dark videos
 * - Folder navigation
 * - Auto-refresh support
 */

import { LitElement, html, css } from "https://unpkg.com/lit-element@2.5.1/lit-element.js?module";
import { repeat } from "https://unpkg.com/lit-html@1.4.1/directives/repeat.js?module";

// --- DATABASE HELPER (IndexedDB) ---
class LookoutDB {
  static DB_NAME = "LookoutGalleryDB";
  static STORE_NAME = "thumbnails";
  static VERSION = 3; // Bumped for new schema with isBroken field
  static MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

  static _dbInstance = null;

  // v1.2.3: Check if connection is still alive
  static _isConnectionAlive() {
    if (!LookoutDB._dbInstance) return false;
    try {
      // Try to access objectStoreNames - throws if connection is dead
      const _ = LookoutDB._dbInstance.objectStoreNames;
      return true;
    } catch (e) {
      console.warn("[LookoutDB] Connection dead, will reconnect");
      LookoutDB._dbInstance = null;
      return false;
    }
  }

  static async open() {
    // v1.2.3: Check if existing connection is still valid
    if (LookoutDB._dbInstance && LookoutDB._isConnectionAlive()) {
      return LookoutDB._dbInstance;
    }
    
    // Reset instance if it was invalid
    LookoutDB._dbInstance = null;

    return new Promise((resolve, reject) => {
      const req = indexedDB.open(LookoutDB.DB_NAME, LookoutDB.VERSION);
      
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        // Delete old store to rebuild with new schema
        if (db.objectStoreNames.contains(LookoutDB.STORE_NAME)) {
          db.deleteObjectStore(LookoutDB.STORE_NAME);
        }
        const store = db.createObjectStore(LookoutDB.STORE_NAME, { keyPath: "id" });
        store.createIndex("created", "created", { unique: false });
      };
      
      req.onsuccess = () => {
        LookoutDB._dbInstance = req.result;
        
        // Handle connection close
        LookoutDB._dbInstance.onclose = () => {
          console.log("[LookoutDB] Connection closed by browser");
          LookoutDB._dbInstance = null;
        };
        
        resolve(LookoutDB._dbInstance);
      };
      
      req.onerror = () => {
        console.error("[LookoutDB] Failed to open database:", req.error);
        reject(req.error);
      };
    });
  }

  /**
   * Get cached entry - now returns { blob, isBroken } or null
   */
  static async get(id) {
    try {
      const db = await LookoutDB.open();
      return new Promise((resolve) => {
        const tx = db.transaction(LookoutDB.STORE_NAME, "readonly");
        const store = tx.objectStore(LookoutDB.STORE_NAME);
        const req = store.get(id);
        
        req.onsuccess = () => {
          if (req.result) {
            // Check if entry is too old
            if (Date.now() - req.result.created > LookoutDB.MAX_AGE_MS) {
              LookoutDB.delete(id); // Async cleanup
              resolve(null);
            } else {
              // Return object with blob and isBroken status
              resolve({
                blob: req.result.blob || null,
                isBroken: req.result.isBroken || false
              });
            }
          } else {
            resolve(null);
          }
        };
        
        req.onerror = () => {
          console.warn("[LookoutDB] Failed to get entry:", id, req.error);
          resolve(null);
        };
      });
    } catch (e) {
      console.warn("[LookoutDB] Get error:", e);
      return null;
    }
  }

  /**
   * Store entry - now accepts blob and isBroken status
   */
  static async put(id, blob, isBroken = false) {
    try {
      const db = await LookoutDB.open();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(LookoutDB.STORE_NAME, "readwrite");
        const store = tx.objectStore(LookoutDB.STORE_NAME);
        
        store.put({ id, blob, isBroken, created: Date.now() });
        
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => {
          console.warn("[LookoutDB] Failed to put entry:", id, tx.error);
          reject(tx.error);
        };
      });
    } catch (e) {
      console.warn("[LookoutDB] Put error:", e);
      return false;
    }
  }

  static async delete(id) {
    try {
      const db = await LookoutDB.open();
      return new Promise((resolve) => {
        const tx = db.transaction(LookoutDB.STORE_NAME, "readwrite");
        const store = tx.objectStore(LookoutDB.STORE_NAME);
        store.delete(id);
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => resolve(false);
      });
    } catch (e) {
      return false;
    }
  }

  static async clear() {
    try {
      const db = await LookoutDB.open();
      return new Promise((resolve) => {
        const tx = db.transaction(LookoutDB.STORE_NAME, "readwrite");
        tx.objectStore(LookoutDB.STORE_NAME).clear();
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => resolve(false);
      });
    } catch (e) {
      console.warn("[LookoutDB] Clear error:", e);
      return false;
    }
  }

  static async cleanupOldEntries() {
    try {
      const db = await LookoutDB.open();
      const cutoff = Date.now() - LookoutDB.MAX_AGE_MS;
      
      return new Promise((resolve) => {
        const tx = db.transaction(LookoutDB.STORE_NAME, "readwrite");
        const store = tx.objectStore(LookoutDB.STORE_NAME);
        const index = store.index("created");
        const range = IDBKeyRange.upperBound(cutoff);
        
        const req = index.openCursor(range);
        let deletedCount = 0;
        
        req.onsuccess = (e) => {
          const cursor = e.target.result;
          if (cursor) {
            cursor.delete();
            deletedCount++;
            cursor.continue();
          }
        };
        
        tx.oncomplete = () => {
          if (deletedCount > 0) {
            console.log(`[LookoutDB] Cleaned up ${deletedCount} old entries`);
          }
          resolve(deletedCount);
        };
        
        tx.onerror = () => resolve(0);
      });
    } catch (e) {
      return 0;
    }
  }
}

// --- TRANSLATIONS ---
const TEXTS = {
  en: {
    load_more: "Load more",
    hidden_files: "hidden files",
    refresh: "Refresh",
    sort_desc: "Newest first",
    sort_asc: "Oldest first",
    home: "Back to Home",
    loading: "Loading media...",
    no_files: "No files found.",
    error: "Error loading",
    folder: "Folder",
    config_group_general: "General",
    config_title: "Title",
    config_path: "Path (media-source://...)",
    config_refresh: "Auto-Refresh (Seconds, 0 = Off)",
    config_recursive: "Recursive search (Show subfolders)",
    config_filter_broken: "Hide corrupt/empty files (Smart Filter)",
    config_threshold: "Darkness Threshold (0 = Off, only filter corrupt)",
    config_threshold_help: "Set to 0 to keep dark night recordings!",
    config_group_layout: "Layout & Display",
    config_columns: "Columns",
    config_init_count: "Initial Count",
    config_align: "Title Alignment",
    config_menu_pos: "Menu Position",
    config_group_sort: "Sorting & Date",
    config_sort_date: "Sort by date in filename",
    config_sort_reverse: "Reverse sort (Newest first)",
    config_date_idx: "Date Start-Index in Filename",
    config_format: "Date Format (e.g. DD.MM HH:mm)",
    config_group_btn: "Load More Button",
    config_btn_label: "Button Label",
    config_btn_count: "Items per click",
    config_btn_bg: "Background Color",
    config_btn_text: "Text Color",
    config_group_ui: "Visibility & Menu",
    config_preview: "Enable Thumbnail Previews",
    config_show_hidden: "Show hidden files count",
    config_show_refresh: "Show Refresh Icon in header",
    config_hide_refresh: "Hide 'Refresh' in menu",
    config_hide_sort: "Hide 'Sort' in menu",
    config_hide_load: "Hide 'Load More' in menu",
    config_lang: "UI Language",
    config_mobile_opt: "Mobile: Disable Smart Filter (Faster)",
    config_mobile_opt_help: "On Mobile: Loads thumbnails instantly but might show black/corrupt files. PC keeps filtering."
  },
  de: {
    load_more: "Mehr laden",
    hidden_files: "ausgeblendet",
    refresh: "Neu laden",
    sort_desc: "Neueste zuerst",
    sort_asc: "Älteste zuerst",
    home: "Zur Startseite",
    loading: "Lade Medien...",
    no_files: "Keine Dateien gefunden.",
    error: "Fehler beim Laden",
    folder: "Ordner",
    config_group_general: "Allgemein",
    config_title: "Titel",
    config_path: "Pfad (media-source://...)",
    config_refresh: "Automatisches Neuladen (Sekunden, 0 = Aus)",
    config_recursive: "Rekursiv durchsuchen (Unterordner anzeigen)",
    config_filter_broken: "Defekte/Leere Dateien ausblenden (Smart Filter)",
    config_threshold: "Helligkeits-Schwellenwert (0 = Aus)",
    config_threshold_help: "Stelle auf 0, um dunkle Nachtaufnahmen zu behalten!",
    config_group_layout: "Layout & Anzeige",
    config_columns: "Spalten",
    config_init_count: "Initiale Anzahl",
    config_align: "Titel Ausrichtung",
    config_menu_pos: "Menü Position",
    config_group_sort: "Sortierung & Datum",
    config_sort_date: "Nach Datum im Dateinamen sortieren",
    config_sort_reverse: "Rückwärts sortieren (Neueste zuerst)",
    config_date_idx: "Datum Start-Index im Dateinamen",
    config_format: "Datumsformat (z.B. DD.MM HH:mm)",
    config_group_btn: "'Mehr Laden' Button",
    config_btn_label: "Button Beschriftung",
    config_btn_count: "Anzahl pro Klick",
    config_btn_bg: "Hintergrundfarbe",
    config_btn_text: "Textfarbe",
    config_group_ui: "Sichtbarkeit & Menü",
    config_preview: "Vorschau-Bilder aktivieren",
    config_show_hidden: "Zeige Anzahl ausgeblendeter Dateien",
    config_show_refresh: "Refresh-Icon in Leiste anzeigen",
    config_hide_refresh: "Verstecke 'Neu laden' im Menü",
    config_hide_sort: "Verstecke 'Sortierung' im Menü",
    config_hide_load: "Verstecke 'Mehr laden' im Menü",
    config_lang: "Sprache (UI)",
    config_mobile_opt: "Mobile: Smart Filter aus (Performance)",
    config_mobile_opt_help: "Am Handy: Lädt sofort, prüft aber nicht auf schwarze Videos. PC prüft weiterhin."
  }
};

// --- UTILITY FUNCTIONS ---
function debounce(fn, delay) {
  let timeoutId;
  return function (...args) {
    clearTimeout(timeoutId);
    timeoutId = setTimeout(() => fn.apply(this, args), delay);
  };
}

function isMobileDevice() {
  // More robust mobile detection
  const userAgent = navigator.userAgent || navigator.vendor || window.opera;
  const mobileRegex = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini|Mobile|mobile|CriOS/i;
  
  // Also check for touch capability and screen size
  const hasTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
  const isSmallScreen = window.innerWidth <= 768;
  
  return mobileRegex.test(userAgent) || (hasTouch && isSmallScreen);
}

// --- MAIN COMPONENT ---
class LookoutGalleryCard extends LitElement {
  
  // Shared cache across instances
  static _internalCache = new Map();

  static get properties() {
    return {
      hass: { type: Object },
      config: { type: Object },
      _mediaEvents: { state: true },
      _history: { state: true },
      _loading: { state: true },
      _playingItem: { state: true },
      _menuOpen: { state: true },
      _currentLimit: { state: true },
      _currentSort: { state: true },
      _hiddenCount: { state: true }
    };
  }

  static getConfigElement() {
    return document.createElement("lookout-gallery-editor");
  }

  static getStubConfig() {
    return {
      title: "LookoutGallery",
      startPath: "media-source://media_source/local/",
      columns: 3,
      maximum_files: 5,
      enablePreview: true,
      filter_broken: true,
      filter_darkness_threshold: 10,
      show_hidden_count: true,
      ui_language: "en",
      mobile_low_resource: false
    };
  }

  static get styles() {
    return css`
      :host { display: block; height: 100%; }
      
      ha-card { 
        height: 100%; 
        display: flex; 
        flex-direction: column; 
        background: var(--ha-card-background, var(--card-background-color, white)); 
        overflow: hidden; 
        border-radius: var(--ha-card-border-radius, 12px); 
        position: relative;
      }
      
      .header {
        display: flex; 
        align-items: center; 
        justify-content: space-between;
        padding: 10px 16px; 
        background: var(--primary-background-color, #fafafa);
        border-bottom: 1px solid var(--divider-color, #e0e0e0);
        color: var(--primary-text-color); 
        min-height: 48px; 
        box-sizing: border-box; 
        flex-shrink: 0; 
        z-index: 10;
      }
      
      .header.bottom { 
        border-bottom: none; 
        border-top: 1px solid var(--divider-color, #e0e0e0); 
        order: 10; 
      }
      
      .header.hidden { display: none; }

      .header-title { 
        font-weight: 500; 
        font-size: 16px; 
        white-space: nowrap; 
        overflow: hidden; 
        text-overflow: ellipsis; 
        flex: 1; 
        margin: 0 12px; 
      }
      
      .header-title.left { text-align: left; }
      .header-title.center { text-align: center; }
      .header-title.right { text-align: right; }

      .header-actions { 
        display: flex; 
        gap: 4px; 
        align-items: center; 
      }
      
      .icon-btn { 
        cursor: pointer; 
        --mdc-icon-size: 24px; 
        color: var(--primary-text-color); 
        padding: 8px;
        border-radius: 50%;
        transition: background-color 0.2s;
      }
      
      .icon-btn:hover { 
        background-color: rgba(0, 0, 0, 0.05); 
      }
      
      .icon-btn[disabled] {
        opacity: 0.4;
        pointer-events: none;
      }
      
      .menu-popup {
        position: absolute; 
        right: 8px; 
        background: var(--card-background-color, white);
        border: 1px solid var(--divider-color, #eee); 
        box-shadow: 0 4px 10px rgba(0, 0, 0, 0.3);
        z-index: 100; 
        border-radius: 4px; 
        display: flex; 
        flex-direction: column; 
        min-width: 200px;
      }
      
      .menu-popup.top-pos { top: 50px; }
      .menu-popup.bottom-pos { bottom: 60px; }
      
      .menu-item { 
        padding: 12px 16px; 
        cursor: pointer; 
        font-size: 14px; 
        display: flex; 
        align-items: center; 
        gap: 12px; 
        color: var(--primary-text-color); 
        border-bottom: 1px solid var(--divider-color, #f0f0f0);
        transition: background-color 0.2s;
      }
      
      .menu-item:last-child {
        border-bottom: none;
      }
      
      .menu-item:hover { 
        background: rgba(0, 0, 0, 0.05); 
      }
      
      .menu-overlay { 
        position: absolute; 
        inset: 0; 
        z-index: 99; 
        background: transparent; 
      }

      .player-container { 
        flex: 1; 
        display: flex; 
        flex-direction: column; 
        background: #000; 
        overflow: hidden; 
        height: 100%; 
      }
      
      .player-menu { 
        background: rgba(255, 255, 255, 0.1); 
        padding: 8px 12px; 
        display: flex; 
        flex-direction: column; 
        gap: 4px; 
        border-bottom: 1px solid #333; 
        flex-shrink: 0; 
      }
      
      .player-controls { 
        display: flex; 
        gap: 20px; 
        align-items: center; 
        justify-content: center; 
      }
      
      .player-filename { 
        font-size: 12px; 
        color: #ccc; 
        text-align: center; 
        white-space: nowrap; 
        overflow: hidden; 
        text-overflow: ellipsis; 
        margin-top: 4px; 
      }
      
      .player-content { 
        flex: 1; 
        display: flex; 
        align-items: center; 
        justify-content: center; 
        background: black; 
        position: relative; 
        overflow: hidden; 
        min-height: 0; 
      }
      
      .player-content video, 
      .player-content img { 
        max-width: 100%; 
        max-height: 100%; 
        width: auto; 
        height: auto; 
      }
      
      .player-menu .icon-btn { 
        color: white; 
      }

      .scroll-wrapper { 
        flex: 1; 
        overflow-y: auto; 
        display: flex; 
        flex-direction: column; 
        padding: 8px; 
      }
      
      .content-grid { 
        display: grid; 
        grid-template-columns: var(--mec-grid-cols); 
        gap: 8px; 
      }
      
      .media-item { 
        position: relative; 
        background: var(--card-background-color); 
        border-radius: 6px; 
        overflow: hidden; 
        cursor: pointer; 
        border: 1px solid var(--divider-color, #eee); 
        display: flex; 
        flex-direction: column; 
        aspect-ratio: 16 / 9;
        transition: transform 0.2s, box-shadow 0.2s;
      }
      
      .media-item:hover {
        transform: translateY(-2px);
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
      }

      @supports not (aspect-ratio: 16 / 9) { 
        .media-item { 
          height: 0; 
          padding-top: 56.25%; 
        } 
      }
      
      .media-preview-container { 
        position: absolute; 
        top: 0; 
        left: 0; 
        width: 100%; 
        height: 100%; 
        display: flex; 
        align-items: center; 
        justify-content: center; 
        background: #000; 
      }
      
      .media-preview-img, 
      .media-preview-video { 
        width: 100%; 
        height: 100%; 
        object-fit: cover; 
        pointer-events: none; 
      }
      
      .media-icon-placeholder { 
        color: var(--secondary-text-color); 
        display: flex; 
        align-items: center; 
        justify-content: center; 
        height: 100%; 
        width: 100%;
        background: var(--secondary-background-color, #f5f5f5);
      }
      
      .media-info { 
        position: absolute; 
        bottom: 0; 
        left: 0; 
        right: 0; 
        background: rgba(0, 0, 0, 0.75); 
        color: white; 
        font-size: 10px; 
        padding: 4px 6px; 
        text-align: center; 
        white-space: nowrap; 
        overflow: hidden; 
        text-overflow: ellipsis; 
      }
      
      .folder-badge { 
        position: absolute; 
        top: 4px; 
        right: 4px; 
        background: var(--primary-color, #03a9f4); 
        color: white; 
        border-radius: 4px; 
        padding: 2px 6px; 
        font-size: 10px; 
        font-weight: bold; 
        z-index: 2; 
      }

      .footer-actions { 
        padding: 16px 0; 
        display: flex; 
        flex-direction: column; 
        align-items: center; 
        gap: 8px; 
        justify-content: center; 
        width: 100%; 
        position: relative; 
      }
      
      .load-more-btn { 
        background: var(--mec-btn-bg, var(--primary-color)); 
        color: var(--mec-btn-color, white); 
        border: none; 
        padding: 8px 20px; 
        border-radius: 20px; 
        cursor: pointer; 
        font-weight: 500; 
        font-size: 14px; 
        box-shadow: 0 2px 5px rgba(0, 0, 0, 0.2); 
        display: flex; 
        align-items: center; 
        gap: 8px; 
        transition: opacity 0.2s, transform 0.2s; 
      }
      
      .load-more-btn:hover {
        transform: translateY(-1px);
      }
      
      .load-more-btn:active { 
        opacity: 0.8;
        transform: translateY(0);
      }
      
      .hidden-count { 
        font-size: 11px; 
        color: var(--secondary-text-color); 
        background: rgba(0, 0, 0, 0.05); 
        padding: 4px 8px; 
        border-radius: 4px; 
      }
      
      .loading-container { 
        display: flex; 
        align-items: center; 
        justify-content: center; 
        height: 100%; 
        color: var(--secondary-text-color); 
        flex-direction: column; 
        gap: 10px;
        padding: 40px;
      }
      
      .loading-spinner {
        width: 40px;
        height: 40px;
        border: 3px solid var(--divider-color, #e0e0e0);
        border-top-color: var(--primary-color, #03a9f4);
        border-radius: 50%;
        animation: spin 1s linear infinite;
      }
      
      @keyframes spin {
        to { transform: rotate(360deg); }
      }
    `;
  }

  constructor() {
    super();
    this._mediaEvents = { title: "", children: [] };
    this._history = [];
    this._loading = false;
    this._playingItem = null;
    this._menuOpen = false;
    this._currentLimit = 5;
    this._currentSort = 'desc';
    this._hiddenCount = 0;
    this._refreshTimer = null;
    this._initLoaded = false;
    
    // Processing state
    this._activeWorkers = 0;
    this._processingSet = new Set(); // Track items being processed
    this._queueList = [];
    this._lastInteraction = 0;
    
    // Blob URL tracking for cleanup
    this._activeBlobUrls = new Map(); // contentId -> blobUrl
    
    // Item lookup map for O(1) access
    this._itemMap = new Map(); // contentId -> item
    
    // Debounced queue check
    this._debouncedQueueCheck = debounce(this._processQueue.bind(this), 100);
    
    // Mobile detection (cached)
    this._isMobile = isMobileDevice();
  }

  setConfig(config) {
    if (!config.startPath) {
      throw new Error("startPath is required");
    }
    
    this.config = {
      title: "LookoutGallery",
      masonryMaxHeight: "400px",
      itemSize: "120px",
      columns: 0,
      enablePreview: true,
      showMenuButton: true,
      title_align: 'center',
      menu_position: 'top',
      recursive: false,
      parsed_date_sort: false,
      reverse_sort: false,
      file_name_date_begins: 0,
      caption_format: "DD.MM HH:mm",
      maximum_files: 5,
      load_more_count: 10,
      load_more_label: "",
      load_more_color: "",
      load_more_text_color: "",
      ui_show_refresh_icon: true,
      hide_refresh: false,
      hide_sort: false,
      hide_load_more_menu: false,
      hide_home: false,
      auto_refresh_interval: 0,
      filter_broken: false,
      filter_darkness_threshold: 10,
      show_hidden_count: true,
      ui_language: "en",
      mobile_low_resource: false,
      use_server_thumbnails: true,  // Use server-side thumbnail generation
      ...config
    };
    
    this._currentLimit = parseInt(this.config.maximum_files) || 5;
    this._currentSort = this.config.reverse_sort ? 'desc' : 'asc';
    this._serverThumbnailsAvailable = null; // Will be checked on first load
  }

  get t() {
    const lang = this.config?.ui_language || "en";
    return TEXTS[lang] || TEXTS["en"];
  }

  connectedCallback() {
    super.connectedCallback();
    this._startAutoRefresh();
    
    // Run cache cleanup on connect
    LookoutDB.cleanupOldEntries();
    
    // Check if server thumbnails are available
    this._checkServerThumbnails();
    
    // v1.2.3: Handle tab visibility changes
    this._visibilityHandler = this._handleVisibilityChange.bind(this);
    document.addEventListener('visibilitychange', this._visibilityHandler);
    
    // Trigger queue check when reconnected (e.g., switching dashboards)
    if (this._initLoaded && this.hass) {
      // Small delay to ensure DOM is ready
      setTimeout(() => {
        this._planQueueCheck();
        // Also restore blob URLs in case they were invalidated
        this._restoreBlobUrls();
      }, 100);
    }
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this._stopAutoRefresh();
    this._cleanup();
    
    // v1.2.3: Remove visibility handler
    if (this._visibilityHandler) {
      document.removeEventListener('visibilitychange', this._visibilityHandler);
    }
  }
  
  // v1.2.3: Restore thumbnails when tab becomes visible again
  _handleVisibilityChange() {
    if (document.visibilityState === 'visible') {
      console.log("[LookoutGallery] Tab visible again, checking thumbnails...");
      this._restoreBlobUrls();
    }
  }
  
  // v1.2.3: Recreate blob URLs from cache for items that lost their thumbnails
  async _restoreBlobUrls() {
    if (!this._mediaEvents?.children) return;
    
    let restored = 0;
    let needsRefetch = [];
    
    for (const item of this._mediaEvents.children) {
      const sourceItem = this._itemMap.get(item.media_content_id);
      if (!sourceItem) continue;
      
      // Skip if broken
      if (sourceItem.is_broken) continue;
      
      // Skip folders
      if (item.can_expand) continue;
      
      // Check if blob URL is still valid
      if (sourceItem.thumbnail_blob_url) {
        const isValid = await this._isBlobUrlValid(sourceItem.thumbnail_blob_url);
        if (isValid) continue;
        
        // Blob URL is invalid, need to restore
        console.log("[LookoutGallery] Restoring thumbnail for:", item.media_content_id);
        
        try {
          // Try IndexedDB cache first
          const cached = await LookoutDB.get(item.media_content_id);
          if (cached?.blob) {
            // Revoke old URL
            URL.revokeObjectURL(sourceItem.thumbnail_blob_url);
            this._activeBlobUrls.delete(item.media_content_id);
            
            // Create new blob URL
            const blobUrl = URL.createObjectURL(cached.blob);
            this._trackBlobUrl(item.media_content_id, blobUrl);
            sourceItem.thumbnail_blob_url = blobUrl;
            restored++;
          } else {
            // No cache, need to refetch from server
            needsRefetch.push(item);
          }
        } catch (e) {
          console.warn("[LookoutGallery] Failed to restore thumbnail:", e);
          needsRefetch.push(item);
        }
      } else if (sourceItem.checked && !sourceItem.is_broken) {
        // Was checked but has no URL - needs refetch
        needsRefetch.push(item);
      }
    }
    
    // Refetch missing thumbnails from server
    if (needsRefetch.length > 0 && this._serverThumbnailsAvailable) {
      console.log(`[LookoutGallery] Refetching ${needsRefetch.length} thumbnails from server`);
      for (const item of needsRefetch) {
        const sourceItem = this._itemMap.get(item.media_content_id);
        if (!sourceItem) continue;
        
        try {
          const serverThumbUrl = await this._getServerThumbnail(item.media_content_id);
          if (serverThumbUrl) {
            this._trackBlobUrl(item.media_content_id, serverThumbUrl);
            sourceItem.thumbnail_blob_url = serverThumbUrl;
            restored++;
            
            // Cache for next time
            try {
              const response = await fetch(serverThumbUrl);
              const blob = await response.blob();
              await LookoutDB.put(item.media_content_id, blob, false);
            } catch (e) { /* ignore cache errors */ }
          }
        } catch (e) {
          console.warn("[LookoutGallery] Failed to refetch thumbnail:", e);
        }
      }
    }
    
    if (restored > 0) {
      console.log(`[LookoutGallery] Restored ${restored} thumbnails`);
      this.requestUpdate();
    }
  }
  
  // v1.2.3: Check if a blob URL is still valid
  _isBlobUrlValid(blobUrl) {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve(true);
      img.onerror = () => resolve(false);
      // Set a timeout in case it hangs
      setTimeout(() => resolve(false), 100);
      img.src = blobUrl;
    });
  }

  // Check if Lookout Gallery integration is available for server thumbnails
  async _checkServerThumbnails() {
    if (!this.config.use_server_thumbnails) {
      this._serverThumbnailsAvailable = false;
      console.log("[LookoutGallery] Server thumbnails disabled in config");
      return;
    }

    if (!this.hass) {
      // Will retry when hass is available
      return;
    }

    try {
      const result = await this.hass.callWS({
        type: "lookout_gallery/get_config"
      });
      
      this._serverThumbnailsAvailable = result.configured && result.ffmpeg_available;
      
      if (this._serverThumbnailsAvailable) {
        console.log("[LookoutGallery] Server thumbnails available (ffmpeg ready)");
      } else if (result.configured && !result.ffmpeg_available) {
        console.warn("[LookoutGallery] Integration configured but ffmpeg not available");
        this._serverThumbnailsAvailable = false;
      } else {
        console.log("[LookoutGallery] Server thumbnails not available, using browser fallback");
      }
    } catch (e) {
      // Integration not installed
      this._serverThumbnailsAvailable = false;
      console.log("[LookoutGallery] Lookout Gallery integration not installed, using browser fallback");
    }
  }

  // Get thumbnail from server
  async _getServerThumbnail(contentId) {
    try {
      const result = await this.hass.callWS({
        type: "lookout_gallery/get_thumbnail",
        media_content_id: contentId
      });
      
      if (result.success && result.thumbnail) {
        // Convert base64 to blob URL
        const binary = atob(result.thumbnail);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) {
          bytes[i] = binary.charCodeAt(i);
        }
        const blob = new Blob([bytes], { type: result.content_type || 'image/jpeg' });
        return URL.createObjectURL(blob);
      }
      return null;
    } catch (e) {
      console.debug("[LookoutGallery] Failed to get server thumbnail:", e);
      return null;
    }
  }

  _cleanup() {
    // Revoke all active Blob URLs to prevent memory leaks
    for (const [contentId, blobUrl] of this._activeBlobUrls) {
      URL.revokeObjectURL(blobUrl);
    }
    this._activeBlobUrls.clear();
    
    // Clear processing state
    this._processingSet.clear();
    this._queueList = [];
    this._activeWorkers = 0;
  }

  _startAutoRefresh() {
    // Ensure only one timer exists
    this._stopAutoRefresh();
    
    const interval = parseInt(this.config?.auto_refresh_interval) || 0;
    if (interval > 0) {
      this._refreshTimer = setInterval(() => {
        // Skip if user recently interacted
        if (Date.now() - this._lastInteraction < 30000) return;
        
        // Skip if processing is happening or player is open
        if (this._activeWorkers > 0 || this._queueList.length > 0 || this._playingItem) return;
        
        // Only refresh if at root level
        if (this._history.length === 0) {
          this._loadMedia(null, true, true);
        }
      }, interval * 1000);
    }
  }

  _stopAutoRefresh() {
    if (this._refreshTimer) {
      clearInterval(this._refreshTimer);
      this._refreshTimer = null;
    }
  }

  updated(changedProps) {
    if (changedProps.has('hass') && !this._initLoaded && this.hass) {
      this._initLoaded = true;
      // Check server thumbnails when hass first becomes available
      if (this._serverThumbnailsAvailable === null) {
        this._checkServerThumbnails();
      }
      this._loadMedia();
    }
    
    if (changedProps.has('_currentLimit') || 
        changedProps.has('_mediaEvents') || 
        changedProps.has('_currentSort') || 
        changedProps.has('_loading')) {
      this._planQueueCheck();
    }
  }

  firstUpdated() {
    // Set grid columns
    if (this.config.columns > 0) {
      this.style.setProperty('--mec-grid-cols', `repeat(${this.config.columns}, 1fr)`);
    } else {
      this.style.setProperty('--mec-grid-cols', `repeat(auto-fill, minmax(${this.config.itemSize}, 1fr))`);
    }
    
    // Set max height
    if (this.config.masonryMaxHeight) {
      this.style.maxHeight = this.config.masonryMaxHeight;
    }
    
    // Set button colors
    if (this.config.load_more_color) {
      this.style.setProperty('--mec-btn-bg', this.config.load_more_color);
    }
    if (this.config.load_more_text_color) {
      this.style.setProperty('--mec-btn-color', this.config.load_more_text_color);
    }
  }

  async _loadMedia(contentId, forceRefresh = false, isSilent = false) {
    if (!this.hass) return;
    
    const path = contentId || this.config.startPath;

    // Check cache first (unless forced refresh)
    if (!forceRefresh && !contentId && LookoutGalleryCard._internalCache.has(path)) {
      const cached = LookoutGalleryCard._internalCache.get(path);
      this._setMediaEvents(cached);
      return;
    }

    if (!isSilent) {
      this._loading = true;
    }
    
    try {
      let children = [];
      let title = this.config.title;
      
      if (this.config.recursive && !contentId) {
        children = await this._fetchRecursive(path);
      } else {
        const result = await this.hass.callWS({ 
          type: "media_source/browse_media", 
          media_content_id: path 
        });
        children = result.children || [];
        if (!this.config.title) {
          title = result.title;
        }
      }

      // Merge with existing state on refresh
      if (forceRefresh && this._mediaEvents?.children) {
        const oldMap = new Map(
          this._mediaEvents.children.map(i => [i.media_content_id, i])
        );
        
        children = children.map(newChild => {
          const oldChild = oldMap.get(newChild.media_content_id);
          if (oldChild?.checked) {
            return {
              ...newChild,
              checked: true,
              is_broken: oldChild.is_broken,
              resolved_url: oldChild.resolved_url,
              thumbnail_blob_url: oldChild.thumbnail_blob_url
            };
          }
          return newChild;
        });
      }

      const mediaEvents = { title, children, media_content_id: path };
      this._setMediaEvents(mediaEvents);
      this._loading = false;
      
      // Update cache
      if (!contentId) {
        LookoutGalleryCard._internalCache.set(path, mediaEvents);
      }
    } catch (e) {
      console.error("[LookoutGallery] Failed to load media:", e);
      if (!isSilent) {
        this._mediaEvents = { title: "Error", children: [] };
        this._loading = false;
      }
    }
  }

  _setMediaEvents(mediaEvents) {
    this._mediaEvents = mediaEvents;
    
    // Rebuild item map for O(1) lookups
    this._itemMap.clear();
    for (const item of mediaEvents.children) {
      this._itemMap.set(item.media_content_id, item);
    }
  }

  async _fetchRecursive(path) {
    const collected = [];
    
    try {
      const result = await this.hass.callWS({ 
        type: 'media_source/browse_media', 
        media_content_id: path 
      });
      
      if (result.children) {
        for (const child of result.children) {
          if (child.can_expand) {
            const subItems = await this._fetchRecursive(child.media_content_id);
            collected.push(...subItems);
          } else {
            collected.push(child);
          }
        }
      }
    } catch (e) {
      console.warn("[LookoutGallery] Failed to fetch recursive:", path, e);
    }
    
    return collected;
  }

  _getVisibleItems() {
    if (!this._mediaEvents?.children) return [];
    
    let processed = [...this._mediaEvents.children];
    
    // Filter out folders in recursive mode
    if (this.config.recursive) {
      processed = processed.filter(f => !f.can_expand);
    }
    
    // Filter broken items
    if (this.config.filter_broken) {
      processed = processed.filter(item => item.is_broken !== true);
    }

    // Calculate hidden count
    this._hiddenCount = this._mediaEvents.children.length - processed.length;

    // Sort by parsed date if enabled
    if (this.config.parsed_date_sort) {
      processed.sort((a, b) => {
        const dateA = this._parseDate(a.title || a.media_content_id);
        const dateB = this._parseDate(b.title || b.media_content_id);
        if (!dateA) return 1;
        if (!dateB) return -1;
        return this._currentSort === 'desc' ? dateB - dateA : dateA - dateB;
      });
    }

    // Add display title and merge with source data
    processed = processed.map(item => {
      const date = this._parseDate(item.title);
      const displayTitle = date ? this._formatDate(date) : item.title;
      
      // Use map for O(1) lookup
      const sourceItem = this._itemMap.get(item.media_content_id);
      
      return {
        ...item,
        displayTitle,
        resolved_url: sourceItem?.resolved_url,
        is_broken: sourceItem?.is_broken,
        checked: sourceItem?.checked,
        thumbnail_blob_url: sourceItem?.thumbnail_blob_url
      };
    });

    return processed.slice(0, this._currentLimit);
  }

  _checkImageDarkness(url, threshold) {
    return new Promise((resolve) => {
      const img = new Image();
      img.crossOrigin = "Anonymous";
      
      const timeoutId = setTimeout(() => {
        resolve({ isBad: true, blob: null });
      }, 5000);
      
      img.onload = () => {
        clearTimeout(timeoutId);
        try {
          const canvas = document.createElement('canvas');
          canvas.width = 1;
          canvas.height = 1;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, 1, 1);
          const pixel = ctx.getImageData(0, 0, 1, 1).data;
          
          // Check for transparency (corrupt)
          if (pixel[3] === 0) {
            resolve({ isBad: true, blob: null });
            return;
          }
          
          // Check darkness
          if (threshold > 0) {
            const brightness = (pixel[0] + pixel[1] + pixel[2]) / 3;
            resolve({ isBad: brightness < threshold, blob: null });
          } else {
            resolve({ isBad: false, blob: null });
          }
        } catch (e) {
          resolve({ isBad: false, blob: null });
        }
      };
      
      img.onerror = () => {
        clearTimeout(timeoutId);
        resolve({ isBad: true, blob: null });
      };
      
      img.src = url;
    });
  }

  _checkVideoValidity(url, threshold) {
    // Skip processing on mobile if configured
    if (this.config.mobile_low_resource && this._isMobile) {
      return Promise.resolve({ isBad: false, blob: null });
    }

    return new Promise((resolve) => {
      const video = document.createElement('video');
      video.muted = true;
      video.playsInline = true;
      video.preload = 'metadata';
      video.crossOrigin = "Anonymous";
      video.style.display = 'none';

      let resolved = false;
      
      const cleanup = () => {
        video.src = "";
        video.load();
      };
      
      const done = (result) => {
        if (resolved) return;
        resolved = true;
        clearTimeout(metaTimer);
        clearTimeout(seekTimer);
        cleanup();
        resolve(result);
      };

      const captureFrame = () => {
        try {
          const canvas = document.createElement('canvas');
          canvas.width = 320;
          canvas.height = 180;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          
          // Check darkness on the captured frame
          let isBad = false;
          if (threshold > 0) {
            const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
            const pixels = imageData.data;
            let totalBrightness = 0;
            const sampleCount = 100; // Sample 100 random pixels
            
            for (let i = 0; i < sampleCount; i++) {
              const idx = Math.floor(Math.random() * (pixels.length / 4)) * 4;
              totalBrightness += (pixels[idx] + pixels[idx + 1] + pixels[idx + 2]) / 3;
            }
            
            const avgBrightness = totalBrightness / sampleCount;
            isBad = avgBrightness < threshold;
          }
          
          // Generate thumbnail blob
          canvas.toBlob((blob) => {
            done({ isBad, blob });
          }, 'image/jpeg', 0.7);
          
        } catch (e) {
          console.warn("[LookoutGallery] Failed to capture frame:", e);
          done({ isBad: false, blob: null });
        }
      };

      // Timeout for metadata loading
      const metaTimer = setTimeout(() => {
        done({ isBad: false, blob: null });
      }, 5000);
      
      let seekTimer = null;

      video.onloadedmetadata = () => {
        clearTimeout(metaTimer);
        
        if (video.duration === 0 || !isFinite(video.duration)) {
          done({ isBad: true, blob: null });
          return;
        }
        
        // Seek to a frame
        const targetTime = Math.min(0.5, video.duration / 2);
        video.currentTime = targetTime;
        
        // Timeout for seeking
        seekTimer = setTimeout(() => {
          done({ isBad: false, blob: null });
        }, 5000);
      };

      video.onseeked = () => {
        clearTimeout(seekTimer);
        captureFrame();
      };
      
      video.onerror = () => {
        done({ isBad: true, blob: null });
      };
      
      video.src = url;
    });
  }

  _planQueueCheck() {
    if (!this.config?.enablePreview) return;
    
    const visible = this._getVisibleItems();
    
    // Build queue of items that need processing
    this._queueList = visible.filter(item => {
      if (item.can_expand) return false;
      
      // Use map for O(1) lookup
      const sourceItem = this._itemMap.get(item.media_content_id);
      if (!sourceItem) return false;
      
      // Skip if already checked or being processed
      if (sourceItem.checked) return false;
      if (this._processingSet.has(item.media_content_id)) return false;
      
      return true;
    });

    if (this._queueList.length > 0) {
      this._debouncedQueueCheck();
    }
  }

  async _processQueue() {
    const maxConcurrent = this._isMobile ? 1 : 3;

    while (this._activeWorkers < maxConcurrent && this._queueList.length > 0) {
      const item = this._queueList.shift();
      
      // Double-check it's not being processed
      if (this._processingSet.has(item.media_content_id)) {
        continue;
      }
      
      this._runWorker(item);
    }
  }

  async _runWorker(item) {
    const contentId = item.media_content_id;
    
    // Mark as processing immediately
    this._processingSet.add(contentId);
    this._activeWorkers++;
    
    const threshold = parseInt(this.config.filter_darkness_threshold) || 0;
    const sourceItem = this._itemMap.get(contentId);
    
    if (!sourceItem) {
      this._finishWorker(contentId);
      return;
    }

    try {
      // 1. Check IndexedDB cache first
      const cached = await LookoutDB.get(contentId);
      
      if (cached) {
        // v1.2.1: Check if it was marked as broken
        if (cached.isBroken) {
          sourceItem.is_broken = true;
          sourceItem.checked = true;
          this.requestUpdate();
          this._finishWorker(contentId);
          // v1.2.2: Immediately check for new items that need loading
          setTimeout(() => this._planQueueCheck(), 10);
          return;
        }
        
        // Has valid thumbnail blob
        if (cached.blob) {
          const blobUrl = URL.createObjectURL(cached.blob);
          this._trackBlobUrl(contentId, blobUrl);
          
          sourceItem.thumbnail_blob_url = blobUrl;
          sourceItem.checked = true;
          sourceItem.is_broken = false;
          
          this.requestUpdate();
          this._finishWorker(contentId);
          return;
        }
      }

      // 2. Try server thumbnail first if available
      if (this._serverThumbnailsAvailable) {
        const serverThumbUrl = await this._getServerThumbnail(contentId);
        if (serverThumbUrl) {
          this._trackBlobUrl(contentId, serverThumbUrl);
          sourceItem.thumbnail_blob_url = serverThumbUrl;
          sourceItem.checked = true;
          sourceItem.is_broken = false;
          
          // Also cache in IndexedDB for offline use
          try {
            const response = await fetch(serverThumbUrl);
            const blob = await response.blob();
            await LookoutDB.put(contentId, blob, false);
          } catch (e) {
            // Caching failed, but thumbnail still works
          }
          
          this.requestUpdate();
          this._finishWorker(contentId);
          return;
        }
      }

      // 3. Resolve media URL (fallback to browser-side generation)
      const source = await this.hass.callWS({ 
        type: "media_source/resolve_media", 
        media_content_id: contentId 
      });
      
      sourceItem.resolved_url = source.url;

      // 4. Validate and generate thumbnail (browser-side fallback)
      let result;
      if (item.media_class === 'video') {
        result = await this._checkVideoValidity(source.url, threshold);
      } else {
        result = await this._checkImageDarkness(source.url, threshold);
      }

      // 5. Save to IndexedDB - v1.2.1: Now includes isBroken status!
      if (result.isBad && this.config.filter_broken) {
        sourceItem.is_broken = true;
        // Save broken status to cache (no blob, but isBroken=true)
        await LookoutDB.put(contentId, null, true);
        // v1.2.2: Immediately check for new items that need loading
        sourceItem.checked = true;
        this.requestUpdate();
        this._finishWorker(contentId);
        setTimeout(() => this._planQueueCheck(), 10);
        return;
      } else if (result.blob) {
        // Save thumbnail blob (not broken)
        await LookoutDB.put(contentId, result.blob, false);
        
        // Create and track blob URL
        const blobUrl = URL.createObjectURL(result.blob);
        this._trackBlobUrl(contentId, blobUrl);
        sourceItem.thumbnail_blob_url = blobUrl;
      }

      sourceItem.checked = true;
      this.requestUpdate();
      
    } catch (e) {
      console.warn("[LookoutGallery] Worker error for:", contentId, e);
      sourceItem.checked = true;
    }

    this._finishWorker(contentId);
  }

  _finishWorker(contentId) {
    this._processingSet.delete(contentId);
    this._activeWorkers--;
    
    // Continue processing queue
    if (this._queueList.length > 0) {
      setTimeout(() => this._processQueue(), 50);
    }
  }

  _trackBlobUrl(contentId, blobUrl) {
    // Revoke old URL if exists
    const oldUrl = this._activeBlobUrls.get(contentId);
    if (oldUrl) {
      URL.revokeObjectURL(oldUrl);
    }
    
    // Track new URL
    this._activeBlobUrls.set(contentId, blobUrl);
  }

  _handleItemClick(item) {
    this._lastInteraction = Date.now();
    
    if (item.can_expand) {
      // Navigate to folder
      this._history.push(this._mediaEvents);
      this._currentLimit = parseInt(this.config.maximum_files) || 5;
      this._loadMedia(item.media_content_id);
    } else {
      // Play media
      this._openPlayer(item);
    }
  }

  async _openPlayer(item) {
    // Resolve URL if not available
    if (!item.resolved_url) {
      try {
        const result = await this.hass.callWS({ 
          type: "media_source/resolve_media", 
          media_content_id: item.media_content_id 
        });
        
        // Update source item
        const sourceItem = this._itemMap.get(item.media_content_id);
        if (sourceItem) {
          sourceItem.resolved_url = result.url;
        }
        item.resolved_url = result.url;
      } catch (e) {
        console.error("[LookoutGallery] Failed to resolve media:", e);
        return;
      }
    }
    
    this._playingItem = item;
  }

  _parseDate(filename) {
    if (!filename) return null;
    
    const start = parseInt(this.config.file_name_date_begins) || 0;
    if (filename.length < start + 14) return null;
    
    const dateStr = filename.substring(start, start + 14);
    if (!/^\d{14}$/.test(dateStr)) return null;
    
    const Y = parseInt(dateStr.substring(0, 4));
    const M = parseInt(dateStr.substring(4, 6)) - 1;
    const D = parseInt(dateStr.substring(6, 8));
    const H = parseInt(dateStr.substring(8, 10));
    const m = parseInt(dateStr.substring(10, 12));
    const s = parseInt(dateStr.substring(12, 14));
    
    const dateObj = new Date(Y, M, D, H, m, s);
    return isNaN(dateObj.getTime()) ? null : dateObj;
  }

  _formatDate(date) {
    const pad = n => n < 10 ? '0' + n : String(n);
    const format = this.config.caption_format || "DD.MM HH:mm";
    
    return format
      .replace("YYYY", String(date.getFullYear()))
      .replace("DD", pad(date.getDate()))
      .replace("MM", pad(date.getMonth() + 1))
      .replace("HH", pad(date.getHours()))
      .replace("mm", pad(date.getMinutes()))
      .replace("ss", pad(date.getSeconds()));
  }

  _toggleMenu() {
    this._lastInteraction = Date.now();
    this._menuOpen = !this._menuOpen;
  }

  _menuAction(action) {
    this._lastInteraction = Date.now();
    this._menuOpen = false;
    
    switch (action) {
      case 'refresh':
        LookoutGalleryCard._internalCache.clear();
        this._loadMedia(this._mediaEvents?.media_content_id, true);
        break;
      case 'home':
        this._history = [];
        this._loadMedia();
        break;
      case 'load_more':
        this._increaseLimit();
        break;
      case 'sort_toggle':
        this._currentSort = this._currentSort === 'desc' ? 'asc' : 'desc';
        break;
    }
  }

  _increaseLimit() {
    this._lastInteraction = Date.now();
    const step = parseInt(this.config.load_more_count) || 10;
    this._currentLimit += step;
  }

  _closePlayer() {
    this._playingItem = null;
  }

  _toggleFullscreen() {
    const el = this.shadowRoot?.getElementById('player-content');
    if (!el) return;
    
    if (!document.fullscreenElement) {
      el.requestFullscreen().catch(err => {
        console.warn("[LookoutGallery] Fullscreen error:", err);
      });
    } else {
      document.exitFullscreen();
    }
  }

  _playNext() {
    this._lastInteraction = Date.now();
    this._navigatePlayer(1);
  }

  _playPrev() {
    this._lastInteraction = Date.now();
    this._navigatePlayer(-1);
  }

  async _navigatePlayer(direction) {
    const visible = this._getVisibleItems();
    const currentIndex = visible.findIndex(
      i => i.media_content_id === this._playingItem?.media_content_id
    );
    
    if (currentIndex === -1) return;
    
    const newIndex = currentIndex + direction;
    if (newIndex < 0 || newIndex >= visible.length) return;
    
    const nextItem = visible[newIndex];
    await this._openPlayer(nextItem);
  }

  _handleBack() {
    this._lastInteraction = Date.now();
    
    if (this._history.length > 0) {
      const prev = this._history.pop();
      this._setMediaEvents(prev);
      this._currentLimit = parseInt(this.config.maximum_files) || 5;
      this.requestUpdate();
    } else {
      this._loadMedia();
    }
  }

  render() {
    if (this._playingItem) {
      return this._renderPlayer();
    }
    
    return this._renderGallery();
  }

  _renderGallery() {
    const T = this.t;
    
    // Header classes
    let headerClass = 'header';
    let popupClass = 'menu-popup top-pos';
    
    if (this.config.menu_position === 'bottom') {
      headerClass = 'header bottom';
      popupClass = 'menu-popup bottom-pos';
    } else if (this.config.menu_position === 'hidden') {
      headerClass = 'header hidden';
    }

    const showLoadMore = !this._loading && 
      this._mediaEvents.children.length > this._currentLimit;
    const showHidden = this.config.show_hidden_count && this._hiddenCount > 0;
    const showFooter = showLoadMore || showHidden;

    return html`
      <ha-card>
        <div class="${headerClass}">
          <div class="header-actions">
            ${this._history.length > 0 ? html`
              <ha-icon 
                class="icon-btn" 
                icon="mdi:arrow-left" 
                @click=${this._handleBack}
              ></ha-icon>
            ` : ''}
          </div>
          
          <div class="header-title ${this.config.title_align}">
            ${this._mediaEvents.title || this.config.title}
          </div>
          
          <div class="header-actions">
            ${this.config.ui_show_refresh_icon ? html`
              <ha-icon 
                class="icon-btn" 
                icon="mdi:refresh" 
                @click=${() => this._menuAction('refresh')}
              ></ha-icon>
            ` : ''}
            
            ${this.config.showMenuButton ? html`
              <ha-icon 
                class="icon-btn" 
                icon="mdi:dots-vertical" 
                @click=${this._toggleMenu}
              ></ha-icon>
            ` : ''}
            
            ${this._menuOpen ? html`
              <div class="menu-overlay" @click=${this._toggleMenu}></div>
              <div class="${popupClass}">
                ${!this.config.hide_refresh ? html`
                  <div class="menu-item" @click=${() => this._menuAction('refresh')}>
                    <ha-icon icon="mdi:refresh"></ha-icon>
                    ${T.refresh}
                  </div>
                ` : ''}
                
                ${!this.config.hide_sort ? html`
                  <div class="menu-item" @click=${() => this._menuAction('sort_toggle')}>
                    <ha-icon icon="${this._currentSort === 'desc' 
                      ? 'mdi:sort-calendar-descending' 
                      : 'mdi:sort-calendar-ascending'}"></ha-icon>
                    ${this._currentSort === 'desc' ? T.sort_desc : T.sort_asc}
                  </div>
                ` : ''}
                
                ${!this.config.hide_load_more_menu ? html`
                  <div class="menu-item" @click=${() => this._menuAction('load_more')}>
                    <ha-icon icon="mdi:download"></ha-icon>
                    +${this.config.load_more_count || 10} ${T.load_more}
                  </div>
                ` : ''}
                
                ${this._history.length > 0 && !this.config.hide_home ? html`
                  <div class="menu-item" @click=${() => this._menuAction('home')}>
                    <ha-icon icon="mdi:home"></ha-icon>
                    ${T.home}
                  </div>
                ` : ''}
              </div>
            ` : ''}
          </div>
        </div>
        
        <div class="scroll-wrapper">
          ${this._loading ? html`
            <div class="loading-container">
              <div class="loading-spinner"></div>
              <div>${T.loading}</div>
            </div>
          ` : ''}
          
          ${!this._loading && this._mediaEvents.children.length === 0 ? html`
            <div class="loading-container">
              ${T.no_files}
            </div>
          ` : ''}
          
          <div class="content-grid">
            ${this._renderGridItems()}
          </div>
          
          ${showFooter ? html`
            <div class="footer-actions">
              ${showHidden ? html`
                <div class="hidden-count">
                  <ha-icon 
                    icon="mdi:filter-remove" 
                    style="--mdc-icon-size: 14px; margin-right: 4px; vertical-align: -2px;"
                  ></ha-icon>
                  ${this._hiddenCount} ${T.hidden_files}
                </div>
              ` : ''}
              
              ${showLoadMore ? html`
                <button class="load-more-btn" @click=${this._increaseLimit}>
                  <ha-icon icon="mdi:dots-horizontal"></ha-icon>
                  ${this.config.load_more_label || T.load_more}
                </button>
              ` : ''}
            </div>
          ` : ''}
        </div>
      </ha-card>
    `;
  }

  _renderGridItems() {
    const items = this._getVisibleItems();
    const T = this.t;
    
    return repeat(
      items,
      (item) => item.media_content_id,
      (item) => html`
        <div class="media-item" @click=${() => this._handleItemClick(item)}>
          <div class="media-preview-container">
            ${item.can_expand ? html`
              <div class="media-icon-placeholder">
                <ha-icon icon="mdi:folder" style="--mdc-icon-size: 36px;"></ha-icon>
              </div>
            ` : item.thumbnail_blob_url ? html`
              <img 
                class="media-preview-img" 
                src="${item.thumbnail_blob_url}" 
                loading="lazy"
                alt="${item.displayTitle || item.title}"
              >
            ` : item.resolved_url ? html`
              ${item.media_class === 'video' ? html`
                <video 
                  class="media-preview-video" 
                  src="${item.resolved_url}#t=0.1" 
                  preload="metadata" 
                  crossorigin="anonymous" 
                  playsinline 
                  muted
                ></video>
              ` : html`
                <img 
                  class="media-preview-img" 
                  src="${item.resolved_url}" 
                  loading="lazy"
                  alt="${item.displayTitle || item.title}"
                >
              `}
            ` : html`
              <div class="media-icon-placeholder">
                <ha-icon 
                  icon="${item.media_class === 'video' ? 'mdi:video' : 'mdi:file'}" 
                  style="--mdc-icon-size: 28px;"
                ></ha-icon>
              </div>
            `}
          </div>
          
          ${item.can_expand ? html`
            <div class="folder-badge">${T.folder}</div>
          ` : ''}
          
          <div class="media-info">
            ${item.displayTitle || item.title}
          </div>
        </div>
      `
    );
  }

  _renderPlayer() {
    const item = this._playingItem;
    const items = this._getVisibleItems();
    const index = items.findIndex(i => i.media_content_id === item?.media_content_id);
    const hasNext = index > -1 && index < items.length - 1;
    const hasPrev = index > 0;

    return html`
      <ha-card>
        <div class="player-container">
          <div class="player-menu">
            <div class="player-controls">
              <ha-icon 
                class="icon-btn" 
                icon="mdi:close" 
                @click=${this._closePlayer} 
                title="Close"
              ></ha-icon>
              
              <div style="flex:1"></div>
              
              <ha-icon 
                class="icon-btn" 
                icon="mdi:skip-previous" 
                ?disabled=${!hasPrev} 
                @click=${this._playPrev} 
                title="Previous"
              ></ha-icon>
              
              <ha-icon 
                class="icon-btn" 
                icon="mdi:skip-next" 
                ?disabled=${!hasNext} 
                @click=${this._playNext} 
                title="Next"
              ></ha-icon>
              
              <div style="flex:1"></div>
              
              <ha-icon 
                class="icon-btn" 
                icon="mdi:fullscreen" 
                @click=${this._toggleFullscreen} 
                title="Fullscreen"
              ></ha-icon>
            </div>
            
            <div class="player-filename">
              ${item?.displayTitle || item?.title}
            </div>
          </div>
          
          <div class="player-content" id="player-content">
            ${item?.media_class === 'video' ? html`
              <video 
                src="${item.resolved_url}" 
                controls 
                autoplay 
                playsinline
              ></video>
            ` : html`
              <img src="${item?.resolved_url}" alt="${item?.displayTitle || item?.title}">
            `}
          </div>
        </div>
      </ha-card>
    `;
  }
}

customElements.define('lookout-gallery-card', LookoutGalleryCard);

// --- EDITOR ---
class LookoutGalleryEditor extends LitElement {
  static get properties() {
    return {
      hass: { type: Object },
      _config: { state: true }
    };
  }

  setConfig(config) {
    this._config = config;
  }

  _valueChanged(ev) {
    if (!this._config || !this.hass) return;
    
    const target = ev.target;
    const value = target.type === 'checkbox' ? target.checked : target.value;
    const configValue = target.getAttribute('configValue');
    
    if (this._config[configValue] === value) return;
    
    this._config = { ...this._config, [configValue]: value };
    this.dispatchEvent(new CustomEvent("config-changed", { 
      detail: { config: this._config } 
    }));
  }

  get t() {
    const lang = this._config?.ui_language || "en";
    return TEXTS[lang] || TEXTS["en"];
  }

  static get styles() {
    return css`
      .card-config { 
        display: flex; 
        flex-direction: column; 
        gap: 12px; 
        padding: 10px 0; 
      }
      
      .group-header { 
        font-weight: bold; 
        text-transform: uppercase; 
        color: var(--primary-color); 
        font-size: 12px; 
        border-bottom: 1px solid var(--divider-color); 
        margin-top: 10px; 
        padding-bottom: 4px; 
      }
      
      .option { 
        display: flex; 
        flex-direction: column; 
        gap: 4px; 
      }
      
      .option label { 
        font-weight: bold; 
        color: var(--primary-text-color); 
        font-size: 13px; 
      }
      
      .option input, 
      .option select { 
        padding: 8px; 
        border: 1px solid var(--divider-color); 
        border-radius: 4px; 
        background: var(--card-background-color); 
        color: var(--primary-text-color); 
        width: 100%; 
        box-sizing: border-box; 
      }
      
      .option.checkbox { 
        flex-direction: row; 
        align-items: center; 
        gap: 10px; 
      }
      
      .option.checkbox input {
        width: auto;
      }
      
      .row { 
        display: flex; 
        gap: 10px; 
      }
      
      .row .option { 
        flex: 1; 
      }
      
      .help { 
        font-size: 11px; 
        color: var(--secondary-text-color); 
        margin-top: -2px; 
      }
    `;
  }

  render() {
    if (!this.hass || !this._config) return html``;
    
    const val = (k, d) => this._config[k] !== undefined ? this._config[k] : (d ?? '');
    const bool = (k, d) => this._config[k] !== undefined ? this._config[k] : (d || false);
    const T = this.t;

    return html`
      <div class="card-config">
        
        <div class="option">
          <label>${TEXTS.en.config_lang} / ${TEXTS.de.config_lang}</label>
          <select 
            .value=${val('ui_language', 'en')} 
            configValue="ui_language" 
            @change=${this._valueChanged}
          >
            <option value="en">English</option>
            <option value="de">Deutsch</option>
          </select>
        </div>

        <div class="group-header">${T.config_group_general}</div>
        
        <div class="option">
          <label>${T.config_title}</label>
          <input 
            type="text" 
            .value=${val('title')} 
            configValue="title" 
            @input=${this._valueChanged}
          >
        </div>
        
        <div class="option">
          <label>${T.config_path}</label>
          <input 
            type="text" 
            .value=${val('startPath')} 
            configValue="startPath" 
            @input=${this._valueChanged}
          >
        </div>
        
        <div class="option">
          <label>${T.config_refresh}</label>
          <input 
            type="number" 
            .value=${val('auto_refresh_interval', 0)} 
            configValue="auto_refresh_interval" 
            @input=${this._valueChanged}
          >
        </div>
        
        <div class="option checkbox">
          <input 
            type="checkbox" 
            .checked=${bool('recursive')} 
            configValue="recursive" 
            @change=${this._valueChanged}
          >
          <label>${T.config_recursive}</label>
        </div>
        
        <div class="option checkbox">
          <input 
            type="checkbox" 
            .checked=${bool('filter_broken')} 
            configValue="filter_broken" 
            @change=${this._valueChanged}
          >
          <label>${T.config_filter_broken}</label>
        </div>
        
        <div class="option">
          <label>${T.config_threshold}</label>
          <input 
            type="number" 
            min="0" 
            max="255" 
            .value=${val('filter_darkness_threshold', 10)} 
            configValue="filter_darkness_threshold" 
            @input=${this._valueChanged}
          >
          <div class="help">${T.config_threshold_help}</div>
        </div>

        <div class="group-header">Performance & Mobile</div>
        
        <div class="option checkbox">
          <input 
            type="checkbox" 
            .checked=${bool('mobile_low_resource')} 
            configValue="mobile_low_resource" 
            @change=${this._valueChanged}
          >
          <label>${T.config_mobile_opt}</label>
        </div>
        <div class="help" style="margin-left: 24px;">${T.config_mobile_opt_help}</div>

        <div class="group-header">${T.config_group_layout}</div>
        
        <div class="row">
          <div class="option">
            <label>${T.config_columns}</label>
            <input 
              type="number" 
              .value=${val('columns', 3)} 
              configValue="columns" 
              @input=${this._valueChanged}
            >
          </div>
          <div class="option">
            <label>${T.config_init_count}</label>
            <input 
              type="number" 
              .value=${val('maximum_files', 5)} 
              configValue="maximum_files" 
              @input=${this._valueChanged}
            >
          </div>
        </div>
        
        <div class="row">
          <div class="option">
            <label>${T.config_align}</label>
            <select 
              .value=${val('title_align', 'center')} 
              configValue="title_align" 
              @change=${this._valueChanged}
            >
              <option value="left">Left</option>
              <option value="center">Center</option>
              <option value="right">Right</option>
            </select>
          </div>
          <div class="option">
            <label>${T.config_menu_pos}</label>
            <select 
              .value=${val('menu_position', 'top')} 
              configValue="menu_position" 
              @change=${this._valueChanged}
            >
              <option value="top">Top</option>
              <option value="bottom">Bottom</option>
              <option value="hidden">Hidden</option>
            </select>
          </div>
        </div>

        <div class="group-header">${T.config_group_sort}</div>
        
        <div class="option checkbox">
          <input 
            type="checkbox" 
            .checked=${bool('parsed_date_sort')} 
            configValue="parsed_date_sort" 
            @change=${this._valueChanged}
          >
          <label>${T.config_sort_date}</label>
        </div>
        
        <div class="option checkbox">
          <input 
            type="checkbox" 
            .checked=${bool('reverse_sort')} 
            configValue="reverse_sort" 
            @change=${this._valueChanged}
          >
          <label>${T.config_sort_reverse}</label>
        </div>
        
        <div class="row">
          <div class="option">
            <label>${T.config_date_idx}</label>
            <input 
              type="number" 
              .value=${val('file_name_date_begins', 0)} 
              configValue="file_name_date_begins" 
              @input=${this._valueChanged}
            >
          </div>
          <div class="option">
            <label>${T.config_format}</label>
            <input 
              type="text" 
              .value=${val('caption_format', 'DD.MM HH:mm')} 
              configValue="caption_format" 
              @input=${this._valueChanged}
            >
          </div>
        </div>

        <div class="group-header">${T.config_group_btn}</div>
        
        <div class="row">
          <div class="option">
            <label>${T.config_btn_label}</label>
            <input 
              type="text" 
              .value=${val('load_more_label', '')} 
              configValue="load_more_label" 
              @input=${this._valueChanged} 
              placeholder="${T.load_more}"
            >
          </div>
          <div class="option">
            <label>${T.config_btn_count}</label>
            <input 
              type="number" 
              .value=${val('load_more_count', 10)} 
              configValue="load_more_count" 
              @input=${this._valueChanged}
            >
          </div>
        </div>
        
        <div class="row">
          <div class="option">
            <label>${T.config_btn_bg}</label>
            <input 
              type="text" 
              .value=${val('load_more_color')} 
              configValue="load_more_color" 
              @input=${this._valueChanged} 
              placeholder="#RRGGBB"
            >
          </div>
          <div class="option">
            <label>${T.config_btn_text}</label>
            <input 
              type="text" 
              .value=${val('load_more_text_color')} 
              configValue="load_more_text_color" 
              @input=${this._valueChanged} 
              placeholder="#RRGGBB"
            >
          </div>
        </div>

        <div class="group-header">${T.config_group_ui}</div>
        
        <div class="option checkbox">
          <input 
            type="checkbox" 
            .checked=${bool('enablePreview', true)} 
            configValue="enablePreview" 
            @change=${this._valueChanged}
          >
          <label>${T.config_preview}</label>
        </div>
        
        <div class="option checkbox">
          <input 
            type="checkbox" 
            .checked=${bool('show_hidden_count', true)} 
            configValue="show_hidden_count" 
            @change=${this._valueChanged}
          >
          <label>${T.config_show_hidden}</label>
        </div>
        
        <div class="option checkbox">
          <input 
            type="checkbox" 
            .checked=${bool('ui_show_refresh_icon', true)} 
            configValue="ui_show_refresh_icon" 
            @change=${this._valueChanged}
          >
          <label>${T.config_show_refresh}</label>
        </div>
        
        <div class="option checkbox">
          <input 
            type="checkbox" 
            .checked=${bool('hide_refresh')} 
            configValue="hide_refresh" 
            @change=${this._valueChanged}
          >
          <label>${T.config_hide_refresh}</label>
        </div>
        
        <div class="option checkbox">
          <input 
            type="checkbox" 
            .checked=${bool('hide_sort')} 
            configValue="hide_sort" 
            @change=${this._valueChanged}
          >
          <label>${T.config_hide_sort}</label>
        </div>
        
        <div class="option checkbox">
          <input 
            type="checkbox" 
            .checked=${bool('hide_load_more_menu')} 
            configValue="hide_load_more_menu" 
            @change=${this._valueChanged}
          >
          <label>${T.config_hide_load}</label>
        </div>
      </div>
    `;
  }
}

customElements.define("lookout-gallery-editor", LookoutGalleryEditor);

// --- REGISTRATION ---
window.customCards = window.customCards || [];
window.customCards.push({
  type: "lookout-gallery-card",
  name: "LookoutGallery",
  preview: true,
  description: "A high-performance media gallery with server-side thumbnails for Home Assistant."
});
