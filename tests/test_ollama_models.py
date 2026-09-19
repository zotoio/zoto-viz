from service import ollama_models


def test_catalog_lists_installed_and_popular() -> None:
    data = ollama_models.catalog(["gemma4:e2b", "my-finetune"], {"gemma4:e2b": 4_000_000_000})
    ids = [r["id"] for r in data["catalog"]]
    assert "gemma4" in ids
    gemma = next(r for r in data["catalog"] if r["id"] == "gemma4")
    assert gemma["installed"] is True
    assert gemma["pull"] is False
    custom = next(r for r in data["catalog"] if r["id"] == "my-finetune")
    assert custom["installed"] is True
    huge = next(r for r in data["catalog"] if r["id"] == "llama3.1:70b")
    assert huge["pull"] is True
    assert huge["vramGb"] == 48


def test_warning_for_small_gpu() -> None:
    assert ollama_models.warning_for(48, 8)
    assert "CPU-only" in (ollama_models.warning_for(8, 0) or "")
    assert ollama_models.warning_for(4, 12) is None
