"""Config flow for Lookout Gallery integration."""
from __future__ import annotations

import logging
import os
from typing import Any

import voluptuous as vol

from homeassistant import config_entries
from homeassistant.core import callback
from homeassistant.data_entry_flow import FlowResult

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

_LOGGER = logging.getLogger(__name__)


def validate_media_paths(paths: list[str]) -> list[str]:
    """Validate media paths exist."""
    valid_paths = []
    for path in paths:
        path = path.strip()
        if path and os.path.isdir(path):
            valid_paths.append(path)
    return valid_paths


class LookoutGalleryConfigFlow(config_entries.ConfigFlow, domain=DOMAIN):
    """Handle a config flow for Lookout Gallery."""

    VERSION = 1

    async def async_step_user(
        self, user_input: dict[str, Any] | None = None
    ) -> FlowResult:
        """Handle the initial step."""
        errors: dict[str, str] = {}

        if user_input is not None:
            paths_str = user_input.get(CONF_MEDIA_PATHS, "/media")
            paths = [p.strip() for p in paths_str.split(",") if p.strip()]
            
            valid_paths = await self.hass.async_add_executor_job(
                validate_media_paths, paths
            )
            
            if not valid_paths:
                errors[CONF_MEDIA_PATHS] = "no_valid_paths"
            else:
                await self.async_set_unique_id(DOMAIN)
                self._abort_if_unique_id_configured()

                return self.async_create_entry(
                    title="Lookout Gallery",
                    data={
                        CONF_MEDIA_PATHS: valid_paths,
                        CONF_THUMBNAIL_WIDTH: user_input.get(CONF_THUMBNAIL_WIDTH, DEFAULT_THUMBNAIL_WIDTH),
                        CONF_THUMBNAIL_HEIGHT: user_input.get(CONF_THUMBNAIL_HEIGHT, DEFAULT_THUMBNAIL_HEIGHT),
                        CONF_THUMBNAIL_QUALITY: user_input.get(CONF_THUMBNAIL_QUALITY, DEFAULT_THUMBNAIL_QUALITY),
                        CONF_FRAME_POSITION: user_input.get(CONF_FRAME_POSITION, DEFAULT_FRAME_POSITION),
                        CONF_THUMBNAIL_FOLDER: user_input.get(CONF_THUMBNAIL_FOLDER, DEFAULT_THUMBNAIL_FOLDER),
                        CONF_AUTO_GENERATE: user_input.get(CONF_AUTO_GENERATE, DEFAULT_AUTO_GENERATE),
                    },
                )

        default_path = "/media"
        if os.path.exists("/media/frigate"):
            default_path = "/media/frigate"

        return self.async_show_form(
            step_id="user",
            data_schema=vol.Schema(
                {
                    vol.Required(CONF_MEDIA_PATHS, default=default_path): str,
                    vol.Optional(CONF_THUMBNAIL_WIDTH, default=DEFAULT_THUMBNAIL_WIDTH): vol.All(vol.Coerce(int), vol.Range(min=80, max=640)),
                    vol.Optional(CONF_THUMBNAIL_HEIGHT, default=DEFAULT_THUMBNAIL_HEIGHT): vol.All(vol.Coerce(int), vol.Range(min=45, max=360)),
                    vol.Optional(CONF_THUMBNAIL_QUALITY, default=DEFAULT_THUMBNAIL_QUALITY): vol.All(vol.Coerce(int), vol.Range(min=10, max=100)),
                    vol.Optional(CONF_FRAME_POSITION, default=DEFAULT_FRAME_POSITION): vol.All(vol.Coerce(float), vol.Range(min=0.0, max=10.0)),
                    vol.Optional(CONF_THUMBNAIL_FOLDER, default=DEFAULT_THUMBNAIL_FOLDER): str,
                    vol.Optional(CONF_AUTO_GENERATE, default=DEFAULT_AUTO_GENERATE): bool,
                }
            ),
            errors=errors,
        )

    @staticmethod
    @callback
    def async_get_options_flow(config_entry: config_entries.ConfigEntry) -> LookoutGalleryOptionsFlow:
        """Get the options flow for this handler."""
        return LookoutGalleryOptionsFlow()


class LookoutGalleryOptionsFlow(config_entries.OptionsFlow):
    """Handle options flow for Lookout Gallery."""

    async def async_step_init(self, user_input: dict[str, Any] | None = None) -> FlowResult:
        """Manage the options."""
        errors: dict[str, str] = {}

        if user_input is not None:
            paths_str = user_input.get(CONF_MEDIA_PATHS, "/media")
            paths = [p.strip() for p in paths_str.split(",") if p.strip()]
            valid_paths = await self.hass.async_add_executor_job(validate_media_paths, paths)

            if not valid_paths:
                errors[CONF_MEDIA_PATHS] = "no_valid_paths"
            else:
                return self.async_create_entry(
                    title="",
                    data={
                        CONF_MEDIA_PATHS: valid_paths,
                        CONF_THUMBNAIL_WIDTH: user_input.get(CONF_THUMBNAIL_WIDTH, DEFAULT_THUMBNAIL_WIDTH),
                        CONF_THUMBNAIL_HEIGHT: user_input.get(CONF_THUMBNAIL_HEIGHT, DEFAULT_THUMBNAIL_HEIGHT),
                        CONF_THUMBNAIL_QUALITY: user_input.get(CONF_THUMBNAIL_QUALITY, DEFAULT_THUMBNAIL_QUALITY),
                        CONF_FRAME_POSITION: user_input.get(CONF_FRAME_POSITION, DEFAULT_FRAME_POSITION),
                        CONF_THUMBNAIL_FOLDER: user_input.get(CONF_THUMBNAIL_FOLDER, DEFAULT_THUMBNAIL_FOLDER),
                        CONF_AUTO_GENERATE: user_input.get(CONF_AUTO_GENERATE, DEFAULT_AUTO_GENERATE),
                    },
                )

        current = {**self.config_entry.data, **self.config_entry.options}
        current_paths = current.get(CONF_MEDIA_PATHS, ["/media"])
        if isinstance(current_paths, list):
            current_paths = ", ".join(current_paths)

        return self.async_show_form(
            step_id="init",
            data_schema=vol.Schema(
                {
                    vol.Required(CONF_MEDIA_PATHS, default=current_paths): str,
                    vol.Optional(CONF_THUMBNAIL_WIDTH, default=current.get(CONF_THUMBNAIL_WIDTH, DEFAULT_THUMBNAIL_WIDTH)): vol.All(vol.Coerce(int), vol.Range(min=80, max=640)),
                    vol.Optional(CONF_THUMBNAIL_HEIGHT, default=current.get(CONF_THUMBNAIL_HEIGHT, DEFAULT_THUMBNAIL_HEIGHT)): vol.All(vol.Coerce(int), vol.Range(min=45, max=360)),
                    vol.Optional(CONF_THUMBNAIL_QUALITY, default=current.get(CONF_THUMBNAIL_QUALITY, DEFAULT_THUMBNAIL_QUALITY)): vol.All(vol.Coerce(int), vol.Range(min=10, max=100)),
                    vol.Optional(CONF_FRAME_POSITION, default=current.get(CONF_FRAME_POSITION, DEFAULT_FRAME_POSITION)): vol.All(vol.Coerce(float), vol.Range(min=0.0, max=10.0)),
                    vol.Optional(CONF_THUMBNAIL_FOLDER, default=current.get(CONF_THUMBNAIL_FOLDER, DEFAULT_THUMBNAIL_FOLDER)): str,
                    vol.Optional(CONF_AUTO_GENERATE, default=current.get(CONF_AUTO_GENERATE, DEFAULT_AUTO_GENERATE)): bool,
                }
            ),
            errors=errors,
        )
