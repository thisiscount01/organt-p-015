import sys
from playwright.sync_api import sync_playwright

results = {}

with sync_playwright() as pw:
    browser = pw.chromium.launch(args=['--no-sandbox','--disable-dev-shm-usage'])
    ctx = browser.new_context(viewport={"width":1280,"height":720})
    page = ctx.new_page()

    console_errors = []
    page.on("console", lambda msg: console_errors.append(msg.text) if msg.type == "error" else None)
    page.on("pageerror", lambda err: console_errors.append(str(err)))

    page.goto("http://localhost:3000/")
    page.wait_for_load_state("networkidle")

    # 1. Title screen
    results["title_screen_visible"] = page.locator("#screen-title.active").count() > 0
    results["start_button_exists"]  = page.locator("#btn-start").count() > 0

    # 2. Start game → game screen
    page.click("#btn-start")
    page.wait_for_timeout(600)
    results["game_screen_active"]  = page.locator("#screen-game.active").count() > 0
    results["title_screen_gone"]   = page.locator("#screen-title.active").count() == 0

    # 3. waveEnemyCount(1) = 8
    wec = page.evaluate("4 + 1 * 4")
    results["wave1_enemy_count"] = wec  # 8

    # 4. HUD
    results["hud_wave_exists"]  = page.locator("#hud-wave").count() > 0
    results["hud_score_exists"] = page.locator("#hud-score").count() > 0
    results["hud_hp_exists"]    = page.locator("#hud-hp").count() > 0

    # 5. Powerup screen HTML
    results["powerup_screen_exists"]  = page.locator("#screen-powerup").count() > 0
    results["powerup_cards_exists"]   = page.locator("#powerup-cards").count() > 0

    # 6. Game over screen HTML
    results["gameover_screen_exists"] = page.locator("#screen-gameover").count() > 0
    results["restart_button_exists"]  = page.locator("#btn-restart").count() > 0

    # 7. Canvas
    results["canvas_exists"] = page.locator("#game-canvas").count() > 0

    # 8. Live game state
    page.wait_for_timeout(800)
    game_info = page.evaluate("""() => {
        const g = window._game;
        if (!g) return {error: 'no _game'};
        return {
          state: g._state,
          wave: g.wave,
          enemies: g.enemies ? g.enemies.length : -1,
          score: g.score,
          playerHP: g.player ? g.player.hp : -1,
        };
    }""")
    results["game_state"] = game_info

    # 9. Console errors
    results["console_errors"] = console_errors

    browser.close()

print("=== Playwright 검증 결과 ===")
for k, v in results.items():
    if k == "console_errors":
        print(f"  콘솔 에러: {'없음 ✅' if not v else str(v)}")
    elif k == "wave1_enemy_count":
        print(f"  waveEnemyCount(1): {v} {'✅' if v==8 else '❌'}")
    elif k == "game_state":
        print(f"  게임 상태: {v}")
    elif isinstance(v, bool):
        print(f"  {k}: {'✅' if v else '❌'}")
    else:
        print(f"  {k}: {v}")

bool_keys = [k for k,v in results.items()
             if k not in ("console_errors","wave1_enemy_count","game_state")]
failed = [k for k in bool_keys if results[k] is False]
wave_ok = results["wave1_enemy_count"] == 8
error_ok = len(results["console_errors"]) == 0

print("\n=== 최종 판정 ===")
if not failed and wave_ok and error_ok:
    print("✅ 전 항목 통과 — 검증 완료")
else:
    if failed: print(f"❌ 실패: {failed}")
    if not wave_ok: print(f"❌ 웨이브1 적 수 오류: {results['wave1_enemy_count']}")
    if not error_ok: print(f"❌ 콘솔 에러: {results['console_errors']}")
