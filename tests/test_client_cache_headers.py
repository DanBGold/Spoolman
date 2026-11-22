"""The SPA handler must make browsers revalidate HTML so updates show up right away."""

from pathlib import Path

from starlette.applications import Starlette
from starlette.testclient import TestClient

from spoolman.client import SinglePageApplication


def _client(tmp_path: Path, base_path: str = "") -> TestClient:
    build = tmp_path / "build"
    (build / "_app" / "immutable").mkdir(parents=True)
    (build / "200.html").write_text(
        '<link rel="icon" href="/favicon.svg"><link rel="apple-touch-icon" href="/apple-touch-icon.png">'
        '<link rel="manifest" href="/manifest.webmanifest"><script src="/_app/x.js"></script>'
        '<script>__sveltekit = { base: "" }</script>'
    )
    (build / "reports.html").write_text("<h1>Reports</h1>")
    (build / "sw.js").write_text("// sw")
    (build / "_app" / "immutable" / "app.abc123.js").write_text("// app")
    app = Starlette()
    app.mount(
        "/" + base_path if base_path else "/",
        SinglePageApplication(str(build), base_path, fallback_document="200.html", rewrite_asset_paths=False),
    )
    return TestClient(app)


def test_prerendered_document_revalidates(tmp_path: Path) -> None:
    r = _client(tmp_path).get("/reports")
    assert r.status_code == 200
    assert r.headers["cache-control"] == "no-cache"


def test_fallback_document_revalidates(tmp_path: Path) -> None:
    r = _client(tmp_path).get("/spool/show/5")
    assert r.status_code == 200
    assert r.headers["cache-control"] == "no-cache"


def test_rewritten_fallback_under_base_path_revalidates(tmp_path: Path) -> None:
    r = _client(tmp_path, "spoolman").get("/spoolman/spool/show/5")
    assert r.status_code == 200
    assert r.headers["cache-control"] == "no-cache"


def test_service_worker_revalidates(tmp_path: Path) -> None:
    assert _client(tmp_path).get("/sw.js").headers["cache-control"] == "no-cache"


def test_hashed_assets_untouched(tmp_path: Path) -> None:
    r = _client(tmp_path).get("/_app/immutable/app.abc123.js")
    assert r.status_code == 200
    assert "cache-control" not in r.headers


def test_not_modified_keeps_header(tmp_path: Path) -> None:
    client = _client(tmp_path)
    etag = client.get("/reports").headers["etag"]
    r = client.get("/reports", headers={"If-None-Match": etag})
    assert r.status_code == 304
    assert r.headers["cache-control"] == "no-cache"
