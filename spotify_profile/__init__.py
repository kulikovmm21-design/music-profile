"""Парсер экспорта Spotify и объективная статистика для музыкального профиля."""
from .aliases import AliasMap
from .parser import load_export
from .stats import build_profile

__all__ = ["AliasMap", "load_export", "build_profile"]
