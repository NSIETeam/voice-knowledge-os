import pytest

from voice_memory.jobs import JobStore


@pytest.mark.parametrize("job_id", ["../../outside", "not-a-uuid", "00000000-0000-0000-0000-00000000000A"])
def test_job_store_rejects_noncanonical_job_ids(tmp_path, job_id):
    store = JobStore(tmp_path)

    with pytest.raises(FileNotFoundError):
        store.get(job_id)

    assert not (tmp_path / "outside.json").exists()
