import os

from voice_memory.api import _process_exists


def test_parent_process_probe_checks_exact_pid():
    assert _process_exists(os.getpid())
    assert not _process_exists(2**30)
