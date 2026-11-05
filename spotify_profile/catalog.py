"""Справочник файлов экспорта Spotify: что это и что мы с ним делаем.

Классификация идёт по ИМЕНИ файла и срабатывает ДО чтения: личные файлы
(адрес, платежи, документы, переписка, поисковые запросы) мы не открываем вообще.
Всё, чего нет в справочнике, разбирается по содержимому (parser.detect_kind).

Эту же таблицу повторяет lab/core.js (FILE_CATALOG) — меняй их вместе.
"""
from __future__ import annotations

import re

# Статусы, которые видит пользователь
USED = "used"                    # читаем и используем в статистике
PLANNED = "planned"              # полезно, будем использовать позже
PERSONAL = "personal_not_read"   # личные данные — не открываем
SERVICE = "service"              # пустые или служебные (PDF-инструкция, DJ, ИИ-чат)
UNKNOWN = "unknown"              # не знаем, что это

STATUSES = [USED, PLANNED, PERSONAL, SERVICE, UNKNOWN]

# (шаблон имени без пути, статус, пояснение для людей)
FILE_CATALOG: list[tuple[str, str, str]] = [
    (r"^UserAddress\.json$", PERSONAL, "почтовый адрес"),
    (r"^Payments\.json$", PERSONAL, "платежи и подписка"),
    (r"^Identity\.json$", PERSONAL, "имя и фото профиля"),
    (r"^Identifiers\.json$", PERSONAL, "почта или телефон для входа"),
    (r"^UserAttributes\.json$", PERSONAL, "дата рождения, пол, почта, страна"),
    (r"^MessageData\.json$", PERSONAL, "личные сообщения в Spotify"),
    (r"^SearchQueries\.json$", PERSONAL, "история поиска"),
    (r"^Inferences\.json$", PERSONAL, "рекламные интересы, которые приписал Spotify"),
    (r"^CustomerServiceHistory\.json$", PERSONAL, "обращения в поддержку"),
    (r"^Family.*\.json$", PERSONAL, "семейная подписка"),
    (r"^Follow\.json$", PERSONAL, "подписки и подписчики — имена других людей"),
    (r"^iDJAudio\.json$", SERVICE, "голосовые запросы к DJ"),
    (r"^AgentGateway\.json$", SERVICE, "диалоги с ИИ-помощником Spotify"),
    (r"\.(pdf|txt|html?)$", SERVICE, "инструкция Spotify к архиву"),
]
_COMPILED = [(re.compile(p, re.IGNORECASE), s, why) for p, s, why in FILE_CATALOG]


def is_junk(path: str) -> bool:
    """Мусор, который добавляет macOS при пересжатии архива: __MACOSX/, ._файл, .DS_Store."""
    parts = path.replace("\\", "/").split("/")
    return any(p == "__MACOSX" for p in parts) or parts[-1].startswith("._") or parts[-1] == ".DS_Store"


def classify_name(path: str) -> tuple[str, str] | None:
    """(статус, пояснение) по имени файла, или None — тогда решаем по содержимому."""
    name = path.replace("\\", "/").split("/")[-1]
    for rx, status, why in _COMPILED:
        if rx.search(name):
            return status, why
    return None
