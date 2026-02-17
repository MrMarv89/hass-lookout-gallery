"""Constants for Lookout Gallery integration."""

DOMAIN = "lookout_gallery"
VERSION = "1.0.0"

# Config keys
CONF_MEDIA_PATHS = "media_paths"
CONF_THUMBNAIL_WIDTH = "thumbnail_width"
CONF_THUMBNAIL_HEIGHT = "thumbnail_height"
CONF_THUMBNAIL_QUALITY = "thumbnail_quality"
CONF_FRAME_POSITION = "frame_position"
CONF_THUMBNAIL_FOLDER = "thumbnail_folder"
CONF_AUTO_GENERATE = "auto_generate"

# Defaults
DEFAULT_THUMBNAIL_WIDTH = 320
DEFAULT_THUMBNAIL_HEIGHT = 180
DEFAULT_THUMBNAIL_QUALITY = 70
DEFAULT_FRAME_POSITION = 0.5
DEFAULT_THUMBNAIL_FOLDER = ".thumbnails"
DEFAULT_AUTO_GENERATE = True

# Supported extensions
VIDEO_EXTENSIONS = {".mp4", ".mkv", ".avi", ".mov", ".webm", ".m4v", ".ts"}
IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".gif", ".webp"}
