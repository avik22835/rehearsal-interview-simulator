"""Protect optional API credentials with the current Windows user's DPAPI key."""
import base64
import ctypes
import os
from ctypes import wintypes

class Blob(ctypes.Structure):
    _fields_ = [("size", wintypes.DWORD), ("data", ctypes.POINTER(ctypes.c_byte))]

def transform(value: bytes, encrypt: bool) -> bytes:
    if os.name != "nt":
        raise ValueError("Use SIMULATOR_API_KEY on this platform; saved credentials require Windows DPAPI.")
    buffer = ctypes.create_string_buffer(value)
    source = Blob(len(value), ctypes.cast(buffer, ctypes.POINTER(ctypes.c_byte)))
    output = Blob()
    method = ctypes.windll.crypt32.CryptProtectData if encrypt else ctypes.windll.crypt32.CryptUnprotectData
    if not method(ctypes.byref(source), None, None, None, None, 1, ctypes.byref(output)):
        raise ValueError("Windows could not protect or unlock the provider credential.")
    try:
        return ctypes.string_at(output.data, output.size)
    finally:
        ctypes.windll.kernel32.LocalFree(output.data)

def seal(value: str) -> str:
    return base64.b64encode(transform(value.encode(), True)).decode()

def unseal(value: str) -> str:
    return transform(base64.b64decode(value), False).decode()
