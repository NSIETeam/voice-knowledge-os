from voice_memory.api import VoiceMemoryHandler


def test_api_declares_preflight_contract():
    assert "http://tauri.localhost" in VoiceMemoryHandler.allowed_origins
    assert "*" not in VoiceMemoryHandler.allowed_origins
    assert 204 in VoiceMemoryHandler.do_OPTIONS.__code__.co_consts
