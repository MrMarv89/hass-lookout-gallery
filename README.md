# 🔭 Lookout Gallery for Home Assistant

[![hacs_badge](https://img.shields.io/badge/HACS-Custom-41BDF5.svg)](https://github.com/hacs/integration)
[![GitHub Release](https://img.shields.io/github/release/MrMarv89/hass-lookout-gallery.svg)](https://github.com/MrMarv89/hass-lookout-gallery/releases)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

A high-performance media gallery for Home Assistant with **server-side thumbnail generation**. Browse your camera recordings, snapshots, and media files with lightning-fast thumbnail previews on any device.

![Lookout Gallery Screenshot](images/screenshot.png)

## ✨ Features

- 🖼️ **Server-side thumbnail generation** - Thumbnails are generated on your HA server using ffmpeg, not in the browser
- 📱 **Fast on all devices** - No more waiting on mobile devices or tablets
- 🎬 **Video & Image support** - MP4, MKV, AVI, MOV, WebM, JPG, PNG, and more
- 🔍 **Smart filtering** - Automatically hide corrupt or dark/empty recordings
- 📁 **Folder navigation** - Browse your media folder structure
- 🔄 **Auto-refresh** - Keep up with new recordings automatically
- 💾 **IndexedDB caching** - Works offline after first load
- 🌍 **Multi-language** - English & German UI

## 📦 Installation

### HACS (Recommended)

1. Open HACS in Home Assistant
2. Click the three dots menu → **Custom repositories**
3. Add URL: `https://github.com/MrMarv89/hass-lookout-gallery`
4. Select category: **Integration**
5. Click **Add**
6. Search for "Lookout Gallery" and click **Download**
7. **Restart Home Assistant**
8. Go to **Settings → Devices & Services → Add Integration**
9. Search for "Lookout Gallery" and configure

### Manual Installation

1. Download the [latest release](https://github.com/MrMarv89/hass-lookout-gallery/releases)
2. Extract and copy `custom_components/lookout_gallery` to your `config/custom_components/` folder
3. Restart Home Assistant
4. Add the integration via Settings → Devices & Services

## ⚙️ Configuration

### Integration Setup

When adding the integration, configure these options:

| Option | Default | Description |
|--------|---------|-------------|
| **Media Paths** | `/media` | Comma-separated paths to scan (e.g., `/media/frigate, /media/cameras`) |
| **Thumbnail Width** | 320 | Width in pixels (80-640) |
| **Thumbnail Height** | 180 | Height in pixels (45-360) |
| **JPEG Quality** | 70 | Compression quality (10-100) |
| **Frame Position** | 0.5 | Seconds into video for thumbnail capture |
| **Thumbnail Folder** | `.thumbnails` | Subfolder name for generated thumbnails |
| **Auto-generate** | On | Generate thumbnails automatically on startup |

### Card Configuration

Add the card to your dashboard:

```yaml
type: custom:lookout-gallery-card
title: Camera Recordings
startPath: media-source://media_source/local/cameras
columns: 2
maximum_files: 8
```

### Full Card Options

```yaml
type: custom:lookout-gallery-card

# Required
startPath: media-source://media_source/local/cameras

# Display
title: "My Gallery"
columns: 2                    # Number of columns (0 = auto)
maximum_files: 8              # Initial items to show
load_more_count: 10           # Items per "load more"

# Thumbnails
use_server_thumbnails: true   # Use server-generated thumbnails
enablePreview: true           # Show thumbnails

# Filtering
filter_broken: true           # Hide corrupt/black videos
filter_darkness_threshold: 10 # Brightness threshold (0 = off)

# Sorting
parsed_date_sort: true        # Sort by date in filename
reverse_sort: true            # Newest first
caption_format: "DD.MM HH:mm" # Date display format

# UI
menu_position: top            # top, bottom, hidden
ui_language: en               # en, de
show_hidden_count: true       # Show filtered count

# Auto-refresh
auto_refresh_interval: 0      # Seconds (0 = off)
```

## 🔧 Services

### `lookout_gallery.generate_thumbnails`

Generate thumbnails for all media files.

```yaml
service: lookout_gallery.generate_thumbnails
data:
  path: /media/cameras  # Optional: specific path
```

### `lookout_gallery.clear_cache`

Clear the in-memory thumbnail cache.

```yaml
service: lookout_gallery.clear_cache
```

## 🛠️ How It Works

```
┌──────────────────────────────────────────────────────────┐
│                    Home Assistant                         │
│  ┌─────────────────┐      ┌─────────────────────────┐   │
│  │ Lookout Gallery │      │    Media Files          │   │
│  │   Integration   │ ───► │  /media/cameras/*.mp4   │   │
│  │    (Python)     │      └─────────────────────────┘   │
│  │                 │                 │                   │
│  │   ffmpeg ───────┼─────────────────┘                   │
│  │      │          │                                     │
│  │      ▼          │      ┌─────────────────────────┐   │
│  │  Thumbnails ────┼────► │  .thumbnails/*.jpg      │   │
│  └─────────────────┘      └─────────────────────────┘   │
│           │                          │                   │
│           ▼                          ▼                   │
│  ┌─────────────────────────────────────────────────┐    │
│  │              WebSocket API                       │    │
│  │    lookout_gallery/get_thumbnail                │    │
│  └─────────────────────────────────────────────────┘    │
└──────────────────────────────────────────────────────────┘
                            │
                            ▼
┌──────────────────────────────────────────────────────────┐
│                       Browser                            │
│  ┌─────────────────────────────────────────────────┐    │
│  │           Lookout Gallery Card                   │    │
│  │                                                  │    │
│  │   ┌─────┐  ┌─────┐  ┌─────┐  ┌─────┐          │    │
│  │   │ 📷  │  │ 📷  │  │ 📷  │  │ 📷  │          │    │
│  │   └─────┘  └─────┘  └─────┘  └─────┘          │    │
│  │   Instant thumbnails on any device!            │    │
│  └─────────────────────────────────────────────────┘    │
└──────────────────────────────────────────────────────────┘
```

1. **Integration** scans your configured media paths
2. **ffmpeg** generates thumbnails on the server (not in browser!)
3. **Thumbnails** are stored in `.thumbnails` folders
4. **Card** requests thumbnails via WebSocket API
5. **Result**: Fast loading on all devices!

## 📁 Thumbnail Storage

Thumbnails are stored alongside your media files:

```
/media/cameras/
├── .thumbnails/
│   ├── recording1_abc123.jpg
│   └── recording2_def456.jpg
├── recording1.mp4
└── recording2.mp4
```

## 🐛 Troubleshooting

### Thumbnails not generating?

1. Check if ffmpeg is available:
   - Go to **Developer Tools → Services**
   - Call `lookout_gallery.generate_thumbnails`
   - Check **Settings → System → Logs** for errors

2. Verify media paths exist and are readable

3. Make sure the integration is configured (Settings → Devices & Services)

### Card shows video icons instead of thumbnails?

1. Wait for initial thumbnail generation (can take a few minutes)
2. Check that `use_server_thumbnails: true` in card config
3. Check browser console for errors (F12)

### Slow on first load?

This is normal! Thumbnails are generated on-demand. After the first load, they're cached and load instantly.

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🙏 Credits

Created by [MrMarv89](https://github.com/MrMarv89)

---

**Found a bug?** [Open an issue](https://github.com/MrMarv89/hass-lookout-gallery/issues)

**Have a feature request?** [Start a discussion](https://github.com/MrMarv89/hass-lookout-gallery/discussions)
