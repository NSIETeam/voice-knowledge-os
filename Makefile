.PHONY: smoke demo profiles

smoke:
	PYTHONPATH=src python3 tests/test_smoke.py

demo:
	PYTHONPATH=src python3 -m voice_memory.cli demo ./.voice-memory/demo-vault

profiles:
	PYTHONPATH=src python3 -m voice_memory.cli profiles

