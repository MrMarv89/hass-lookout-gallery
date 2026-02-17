"""Lookout Gallery integration for Home Assistant."""
from __future__ import annotations

import asyncio
import base64
import json
import logging
import os
from pathlib import Path
from typing import Any

from homeassistant.components import websocket_api
from homeassistant.components.frontend import add_extra_js_url
from homeassistant.components.http import StaticPathConfig
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant, ServiceCall
from homeassistant.helpers.typing import ConfigType
import voluptuous as vol

from .const import (
    CONF_AUTO_GENERATE,
    CONF_FRAME_POSITION,
    CONF_MEDIA_PATHS,
    CONF_THUMBNAIL_FOLDER,
    CONF_THUMBNAIL_HEIGHT,
    CONF_THUMBNAIL_QUALITY,
    CONF_THUMBNAIL_WIDTH,
    DEFAULT_AUTO_GENERATE,
    DEFAULT_FRAME_POSITION,
    DEFAULT_THUMBNAIL_FOLDER,
    DEFAULT_THUMBNAIL_HEIGHT,
    DEFAULT_THUMBNAIL_QUALITY,
    DEFAULT_THUMBNAIL_WIDTH,
    DOMAIN,
)
from .thumbnail import ThumbnailGenerator

_LOGGER = logging.getLogger(__name__)

FRONTEND_SCRIPT_URL = "/lookout_gallery/lookout-gallery-card.js"


def get_version(hass: HomeAssistant) -> str:
    """Get version from manifest."""
    manifest_path = hass.config.path("custom_components/lookout_gallery/manifest.json")
    try:
        with open(manifest_path, "r") as fp:
            manifest = json.load(fp)
            return manifest.get("version", "0.0.0")
    except Exception:
        return "0.0.0"


async def async_setup(hass: HomeAssistant, config: ConfigType) -> bool:
    """Set up Lookout Gallery from yaml configuration."""
    hass.data.setdefault(DOMAIN, {})
    return True


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Set up Lookout Gallery from a config entry."""
    hass.data.setdefault(DOMAIN, {})

    # Get version for cache busting
    version = await hass.async_add_executor_job(get_version, hass)

    # Register the frontend JavaScript file (only once)
    if "frontend_loaded" not in hass.data[DOMAIN]:
        try:
            await hass.http.async_register_static_paths(
                [
                    StaticPathConfig(
                        FRONTEND_SCRIPT_URL,
                        hass.config.path("custom_components/lookout_gallery/lookout-gallery-card.js"),
                        True,  # cache_headers
                    )
                ]
            )
            # Add as extra JS so it loads automatically
            add_extra_js_url(hass, f"{FRONTEND_SCRIPT_URL}?v={version}")
            hass.data[DOMAIN]["frontend_loaded"] = True
            _LOGGER.info("Lookout Gallery card registered at %s", FRONTEND_SCRIPT_URL)
        except RuntimeError:
            # Already registered (e.g., after reload)
            _LOGGER.debug("Lookout Gallery card already registered")

    # Get configuration
    config_data = {**entry.data, **entry.options}
    
    media_paths = config_data.get(CONF_MEDIA_PATHS, ["/media"])
    if isinstance(media_paths, str):
        media_paths = [media_paths]

    # Create thumbnail generator
    generator = ThumbnailGenerator(
        hass=hass,
        media_paths=media_paths,
        width=config_data.get(CONF_THUMBNAIL_WIDTH, DEFAULT_THUMBNAIL_WIDTH),
        height=config_data.get(CONF_THUMBNAIL_HEIGHT, DEFAULT_THUMBNAIL_HEIGHT),
        quality=config_data.get(CONF_THUMBNAIL_QUALITY, DEFAULT_THUMBNAIL_QUALITY),
        frame_position=config_data.get(CONF_FRAME_POSITION, DEFAULT_FRAME_POSITION),
        thumbnail_folder=config_data.get(CONF_THUMBNAIL_FOLDER, DEFAULT_THUMBNAIL_FOLDER),
    )

    # Check ffmpeg availability
    await generator.async_check_ffmpeg()

    # Store generator
    hass.data[DOMAIN][entry.entry_id] = {
        "generator": generator,
        "config": config_data,
    }

    # Register WebSocket API
    websocket_api.async_register_command(hass, websocket_get_thumbnail)
    websocket_api.async_register_command(hass, websocket_generate_thumbnails)
    websocket_api.async_register_command(hass, websocket_get_config)

    # Register services
    async def handle_generate_thumbnails(call: ServiceCall) -> None:
        """Handle the generate_thumbnails service call."""
        path = call.data.get("path")
        stats = await generator.async_generate_all_thumbnails(path)
        _LOGGER.info("Thumbnail generation stats: %s", stats)

    async def handle_clear_cache(call: ServiceCall) -> None:
        """Handle the clear_cache service call."""
        generator.clear_cache()
        _LOGGER.info("Thumbnail cache cleared")

    hass.services.async_register(
        DOMAIN,
        "generate_thumbnails",
        handle_generate_thumbnails,
        schema=vol.Schema({
            vol.Optional("path"): str,
        }),
    )

    hass.services.async_register(
        DOMAIN,
        "clear_cache",
        handle_clear_cache,
        schema=vol.Schema({}),
    )

    # Auto-generate thumbnails on startup if enabled
    if config_data.get(CONF_AUTO_GENERATE, DEFAULT_AUTO_GENERATE):
        async def generate_on_startup(_: Any = None) -> None:
            """Generate thumbnails after startup."""
            await asyncio.sleep(60)  # Wait 60 seconds after startup
            await generator.async_generate_all_thumbnails()

        hass.async_create_task(generate_on_startup())

    # Update listener
    entry.async_on_unload(entry.add_update_listener(async_update_options))

    _LOGGER.info("Lookout Gallery integration loaded successfully")
    return True


async def async_update_options(hass: HomeAssistant, entry: ConfigEntry) -> None:
    """Update options."""
    await hass.config_entries.async_reload(entry.entry_id)


async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Unload a config entry."""
    if entry.entry_id in hass.data[DOMAIN]:
        hass.data[DOMAIN].pop(entry.entry_id)

    # Remove services if no entries left
    if not hass.data[DOMAIN]:
        hass.services.async_remove(DOMAIN, "generate_thumbnails")
        hass.services.async_remove(DOMAIN, "clear_cache")

    return True


def _get_generator(hass: HomeAssistant) -> ThumbnailGenerator | None:
    """Get the thumbnail generator instance."""
    for entry_data in hass.data.get(DOMAIN, {}).values():
        if "generator" in entry_data:
            return entry_data["generator"]
    return None


@websocket_api.websocket_command(
    {
        vol.Required("type"): "lookout_gallery/get_thumbnail",
        vol.Required("media_content_id"): str,
    }
)
@websocket_api.async_response
async def websocket_get_thumbnail(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict[str, Any],
) -> None:
    """Handle get_thumbnail websocket command."""
    generator = _get_generator(hass)
    
    if not generator:
        connection.send_error(
            msg["id"],
            "not_configured",
            "Lookout Gallery integration not configured",
        )
        return

    media_content_id = msg["media_content_id"]
    
    try:
        thumb_path = await generator.async_get_thumbnail(media_content_id)
        
        if thumb_path and os.path.exists(thumb_path):
            # Read thumbnail and encode as base64
            def read_thumbnail() -> str:
                with open(thumb_path, "rb") as f:
                    return base64.b64encode(f.read()).decode("utf-8")
            
            thumb_data = await hass.async_add_executor_job(read_thumbnail)
            
            connection.send_result(
                msg["id"],
                {
                    "success": True,
                    "thumbnail": thumb_data,
                    "content_type": "image/jpeg",
                },
            )
        else:
            connection.send_result(
                msg["id"],
                {
                    "success": False,
                    "error": "Could not generate thumbnail",
                },
            )
    except Exception as ex:
        _LOGGER.error("Error getting thumbnail: %s", ex)
        connection.send_error(
            msg["id"],
            "thumbnail_error",
            str(ex),
        )


@websocket_api.websocket_command(
    {
        vol.Required("type"): "lookout_gallery/generate_thumbnails",
        vol.Optional("path"): str,
    }
)
@websocket_api.async_response
async def websocket_generate_thumbnails(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict[str, Any],
) -> None:
    """Handle generate_thumbnails websocket command."""
    generator = _get_generator(hass)
    
    if not generator:
        connection.send_error(
            msg["id"],
            "not_configured",
            "Lookout Gallery integration not configured",
        )
        return

    try:
        path = msg.get("path")
        stats = await generator.async_generate_all_thumbnails(path)
        connection.send_result(msg["id"], stats)
    except Exception as ex:
        _LOGGER.error("Error generating thumbnails: %s", ex)
        connection.send_error(msg["id"], "generation_error", str(ex))


@websocket_api.websocket_command(
    {
        vol.Required("type"): "lookout_gallery/get_config",
    }
)
@websocket_api.async_response
async def websocket_get_config(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict[str, Any],
) -> None:
    """Handle get_config websocket command."""
    generator = _get_generator(hass)
    
    if not generator:
        connection.send_result(
            msg["id"],
            {
                "configured": False,
            },
        )
        return

    # Check ffmpeg
    ffmpeg_available = await generator.async_check_ffmpeg()

    connection.send_result(
        msg["id"],
        {
            "configured": True,
            "ffmpeg_available": ffmpeg_available,
            "media_paths": generator.media_paths,
            "thumbnail_width": generator.width,
            "thumbnail_height": generator.height,
        },
    )
