"""Thumbnail generator for Lookout Gallery."""
from __future__ import annotations

import asyncio
import hashlib
import logging
import os
from pathlib import Path
from typing import TYPE_CHECKING

from .const import (
    DEFAULT_FRAME_POSITION,
    DEFAULT_THUMBNAIL_FOLDER,
    DEFAULT_THUMBNAIL_HEIGHT,
    DEFAULT_THUMBNAIL_QUALITY,
    DEFAULT_THUMBNAIL_WIDTH,
    IMAGE_EXTENSIONS,
    VIDEO_EXTENSIONS,
)

if TYPE_CHECKING:
    from homeassistant.core import HomeAssistant

_LOGGER = logging.getLogger(__name__)


class ThumbnailGenerator:
    """Generate and manage thumbnails for media files."""

    def __init__(
        self,
        hass: HomeAssistant,
        media_paths: list[str],
        width: int = DEFAULT_THUMBNAIL_WIDTH,
        height: int = DEFAULT_THUMBNAIL_HEIGHT,
        quality: int = DEFAULT_THUMBNAIL_QUALITY,
        frame_position: float = DEFAULT_FRAME_POSITION,
        thumbnail_folder: str = DEFAULT_THUMBNAIL_FOLDER,
    ) -> None:
        """Initialize the thumbnail generator."""
        self.hass = hass
        self.media_paths = media_paths
        self.width = width
        self.height = height
        self.quality = quality
        self.frame_position = frame_position
        self.thumbnail_folder = thumbnail_folder
        self._ffmpeg_available: bool | None = None
        self._cache: dict[str, str] = {}

    async def async_check_ffmpeg(self) -> bool:
        """Check if ffmpeg is available."""
        if self._ffmpeg_available is not None:
            return self._ffmpeg_available

        try:
            process = await asyncio.create_subprocess_exec(
                "ffmpeg", "-version",
                stdout=asyncio.subprocess.DEVNULL,
                stderr=asyncio.subprocess.DEVNULL,
            )
            await process.wait()
            self._ffmpeg_available = process.returncode == 0
        except FileNotFoundError:
            self._ffmpeg_available = False

        if not self._ffmpeg_available:
            _LOGGER.warning("ffmpeg not found - thumbnail generation disabled")
        else:
            _LOGGER.info("ffmpeg found - thumbnail generation enabled")

        return self._ffmpeg_available

    def _get_thumbnail_path(self, media_path: str) -> Path:
        """Get the thumbnail path for a media file."""
        media_file = Path(media_path)
        
        # Create hash for unique thumbnail name
        path_hash = hashlib.md5(media_path.encode()).hexdigest()[:8]
        thumb_name = f"{media_file.stem}_{path_hash}.jpg"
        
        # Thumbnail folder is relative to the media file's directory
        thumb_dir = media_file.parent / self.thumbnail_folder
        return thumb_dir / thumb_name

    def _is_video(self, path: str) -> bool:
        """Check if file is a video."""
        return Path(path).suffix.lower() in VIDEO_EXTENSIONS

    def _is_image(self, path: str) -> bool:
        """Check if file is an image."""
        return Path(path).suffix.lower() in IMAGE_EXTENSIONS

    async def async_get_thumbnail(self, media_path: str) -> str | None:
        """Get or generate thumbnail for a media file."""
        # Check cache first
        if media_path in self._cache:
            thumb_path = self._cache[media_path]
            if os.path.exists(thumb_path):
                return thumb_path

        # Resolve actual file path
        actual_path = self._resolve_media_path(media_path)
        if not actual_path or not os.path.exists(actual_path):
            _LOGGER.debug("Media file not found: %s", media_path)
            return None

        thumb_path = self._get_thumbnail_path(actual_path)

        # Check if thumbnail already exists
        if thumb_path.exists():
            if thumb_path.stat().st_mtime >= Path(actual_path).stat().st_mtime:
                self._cache[media_path] = str(thumb_path)
                return str(thumb_path)

        # Generate thumbnail
        if self._is_video(actual_path):
            success = await self._generate_video_thumbnail(actual_path, thumb_path)
        elif self._is_image(actual_path):
            success = await self._generate_image_thumbnail(actual_path, thumb_path)
        else:
            _LOGGER.debug("Unsupported file type: %s", actual_path)
            return None

        if success:
            self._cache[media_path] = str(thumb_path)
            return str(thumb_path)

        return None

    def _resolve_media_path(self, media_content_id: str) -> str | None:
        """Resolve media_content_id to actual file path."""
        # Handle media-source:// URIs
        if media_content_id.startswith("media-source://media_source/"):
            relative_path = media_content_id.replace("media-source://media_source/", "")
            
            if relative_path.startswith("local/"):
                relative_path = relative_path[6:]
            
            # Try /media first
            media_base = Path("/media")
            full_path = media_base / relative_path
            
            if full_path.exists():
                return str(full_path)
            
            # Try configured media paths
            for base_path in self.media_paths:
                test_path = Path(base_path) / relative_path
                if test_path.exists():
                    return str(test_path)
                    
        elif os.path.exists(media_content_id):
            return media_content_id

        return None

    async def _generate_video_thumbnail(self, video_path: str, thumb_path: Path) -> bool:
        """Generate thumbnail from video using ffmpeg."""
        if not await self.async_check_ffmpeg():
            return False

        thumb_path.parent.mkdir(parents=True, exist_ok=True)

        try:
            cmd = [
                "ffmpeg",
                "-y",
                "-ss", str(self.frame_position),
                "-i", video_path,
                "-vframes", "1",
                "-vf", f"scale={self.width}:{self.height}:force_original_aspect_ratio=decrease,pad={self.width}:{self.height}:(ow-iw)/2:(oh-ih)/2",
                "-q:v", str(int((100 - self.quality) / 3.33)),
                str(thumb_path),
            ]

            process = await asyncio.create_subprocess_exec(
                *cmd,
                stdout=asyncio.subprocess.DEVNULL,
                stderr=asyncio.subprocess.PIPE,
            )
            _, stderr = await asyncio.wait_for(process.communicate(), timeout=30)

            if process.returncode != 0:
                _LOGGER.warning("ffmpeg failed for %s: %s", video_path, stderr.decode() if stderr else "Unknown error")
                return False

            _LOGGER.debug("Generated thumbnail for: %s", video_path)
            return True

        except asyncio.TimeoutError:
            _LOGGER.warning("Thumbnail generation timed out for: %s", video_path)
            return False
        except Exception as ex:
            _LOGGER.error("Error generating thumbnail for %s: %s", video_path, ex)
            return False

    async def _generate_image_thumbnail(self, image_path: str, thumb_path: Path) -> bool:
        """Generate thumbnail from image using ffmpeg."""
        if not await self.async_check_ffmpeg():
            return False

        thumb_path.parent.mkdir(parents=True, exist_ok=True)

        try:
            cmd = [
                "ffmpeg",
                "-y",
                "-i", image_path,
                "-vf", f"scale={self.width}:{self.height}:force_original_aspect_ratio=decrease,pad={self.width}:{self.height}:(ow-iw)/2:(oh-ih)/2",
                "-q:v", str(int((100 - self.quality) / 3.33)),
                str(thumb_path),
            ]

            process = await asyncio.create_subprocess_exec(
                *cmd,
                stdout=asyncio.subprocess.DEVNULL,
                stderr=asyncio.subprocess.PIPE,
            )
            _, stderr = await asyncio.wait_for(process.communicate(), timeout=15)

            if process.returncode != 0:
                _LOGGER.warning("ffmpeg failed for %s: %s", image_path, stderr.decode() if stderr else "Unknown error")
                return False

            return True

        except asyncio.TimeoutError:
            _LOGGER.warning("Thumbnail generation timed out for: %s", image_path)
            return False
        except Exception as ex:
            _LOGGER.error("Error generating thumbnail for %s: %s", image_path, ex)
            return False

    async def async_generate_all_thumbnails(self, path: str | None = None) -> dict:
        """Generate thumbnails for all media files in configured paths."""
        stats = {"scanned": 0, "generated": 0, "skipped": 0, "failed": 0}

        paths_to_scan = [path] if path else self.media_paths

        for base_path in paths_to_scan:
            if not os.path.exists(base_path):
                _LOGGER.warning("Media path does not exist: %s", base_path)
                continue

            for root, _, files in os.walk(base_path):
                if self.thumbnail_folder in root:
                    continue

                for filename in files:
                    file_path = os.path.join(root, filename)
                    ext = Path(filename).suffix.lower()

                    if ext not in VIDEO_EXTENSIONS and ext not in IMAGE_EXTENSIONS:
                        continue

                    stats["scanned"] += 1
                    thumb_path = self._get_thumbnail_path(file_path)

                    if thumb_path.exists():
                        if thumb_path.stat().st_mtime >= Path(file_path).stat().st_mtime:
                            stats["skipped"] += 1
                            continue

                    if ext in VIDEO_EXTENSIONS:
                        success = await self._generate_video_thumbnail(file_path, thumb_path)
                    else:
                        success = await self._generate_image_thumbnail(file_path, thumb_path)

                    if success:
                        stats["generated"] += 1
                    else:
                        stats["failed"] += 1

                    await asyncio.sleep(0)

        _LOGGER.info("Thumbnail generation: %d scanned, %d generated, %d skipped, %d failed",
                     stats["scanned"], stats["generated"], stats["skipped"], stats["failed"])

        return stats

    def clear_cache(self) -> None:
        """Clear the in-memory cache."""
        self._cache.clear()
