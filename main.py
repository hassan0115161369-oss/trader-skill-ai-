import asyncio
import json
import math
import os
from datetime import datetime
import aiohttp
import flet as ft
import websockets

DERIV_WS_URL = "wss://ws.derivws.com/websockets/v3?app_id=1089"


def calc_ema(prices: list[float], period: int) -> float | None:
    if len(prices) < period:
        return None
    k = 2.0 / (period + 1)
    ema = sum(prices[:period]) / period
    for p in prices[period:]:
        ema = (p - ema) * k + ema
    return round(ema, 5)


def calc_rsi(prices: list[float], period: int = 14) -> float | None:
    if len(prices) <= period:
        return None
    gains, losses = [], []
    for i in range(1, len(prices)):
        diff = prices[i] - prices[i - 1]
        gains.append(max(diff, 0.0))
        losses.append(abs(min(diff, 0.0)))
    avg_gain = sum(gains[-period:]) / period
    avg_loss = sum(losses[-period:]) / period
    if avg_loss == 0:
        return 100.0
    rs = avg_gain / avg_loss
    return round(100.0 - (100.0 / (1.0 + rs)), 2)


def calc_bollinger(prices: list[float], period: int = 20, mult: float = 2.0):
    if len(prices) < period:
        return None, None, None
    window = prices[-period:]
    mid = sum(window) / period
    variance = sum((x - mid) ** 2 for x in window) / period
    std = math.sqrt(variance)
    return round(mid + mult * std, 5), round(mid, 5), round(mid - mult * std, 5)


class TraderSkillEngine:
    def __init__(self, on_update, on_log):
        self.on_update = on_update
        self.on_log = on_log

        self.platform = "Deriv"
        self.symbol = "R_100"
        self.mode = "DEMO"  # Always starts in DEMO for safety
        self.api_token = ""
        self.tg_token = ""
        self.tg_chat_id = ""

        self.balance = 10000.00
        self.daily_pnl = 0.00
        self.daily_loss_cap = 250.00
        self.daily_profit_target = 500.00
        self.multiplier = 100
        self.stake = 25.00
        self.sl_amount = 10.00
        self.tp_amount = 25.00
        self.consecutive_losses = 0
        self.max_consecutive_losses = 3
        self.cooldown_seconds = 0

        self.ticks: list[float] = []
        self.running = False
        self._task: asyncio.Task | None = None

    async def send_telegram(self, text: str):
        if not self.tg_token or not self.tg_chat_id:
            return
        url = f"https://api.telegram.org/bot{self.tg_token}/sendMessage"
        payload = {"chat_id": self.tg_chat_id, "text": text}
        try:
            async with aiohttp.ClientSession() as session:
                async with session.post(url, json=payload, timeout=8) as resp:
                    if resp.status != 200:
                        self.on_log(f"Telegram HTTP {resp.status}")
        except Exception as exc:
            self.on_log(f"Telegram error: {exc}")

    def check_risk_guards(self) -> tuple[bool, str]:
        if self.cooldown_seconds > 0:
            return False, f"Cooldown active ({self.cooldown_seconds}s)"
        if self.daily_pnl <= -abs(self.daily_loss_cap):
            return False, "Daily loss cap reached"
        if self.daily_pnl >= abs(self.daily_profit_target):
            return False, "Daily profit target reached"
        return True, "OK"

    async def execute_multiplier_trade(self, direction: str, price: float):
        allowed, reason = self.check_risk_guards()
        if not allowed:
            self.on_log(f"Trade blocked: {reason}")
            return

        # Simulated Multiplier outcome driven by EMA/RSI momentum
        ema_fast = calc_ema(self.ticks, 9)
        ema_slow = calc_ema(self.ticks, 21)
        rsi = calc_rsi(self.ticks, 14) or 50.0

        bullish_edge = (
            direction == "MULTUP"
            and ema_fast is not None
            and ema_slow is not None
            and ema_fast >= ema_slow
            and rsi < 75
        )
        bearish_edge = (
            direction == "MULTDOWN"
            and ema_fast is not None
            and ema_slow is not None
            and ema_fast <= ema_slow
            and rsi > 25
        )

        win = bullish_edge or bearish_edge
        pnl = round(self.tp_amount if win else -self.sl_amount, 2)

        self.daily_pnl = round(self.daily_pnl + pnl, 2)
        self.balance = round(self.balance + pnl, 2)

        if win:
            self.consecutive_losses = 0
        else:
            self.consecutive_losses += 1
            if self.consecutive_losses >= self.max_consecutive_losses:
                self.cooldown_seconds = 60
                self.consecutive_losses = 0

        msg = (
            f"[{self.mode} | {self.platform}] {direction} x{self.multiplier} "
            f"{self.symbol} @ {price} | PnL: {pnl:+.2f} | Daily: {self.daily_pnl:+.2f}"
        )
        self.on_log(msg)
        await self.send_telegram(f"🤖 Trader Skill AI\n{msg}")

    async def _stream_loop(self):
        self.on_log(f"Connecting to Deriv WS ({self.symbol}) in {self.mode} mode...")
        while self.running:
            if self.cooldown_seconds > 0:
                await asyncio.sleep(1)
                self.cooldown_seconds = max(0, self.cooldown_seconds - 1)
                self.on_update()
                continue

            try:
                async with websockets.connect(DERIV_WS_URL, ping_interval=20) as ws:
                    if self.api_token:
                        await ws.send(json.dumps({"authorize": self.api_token}))
                        auth_raw = await ws.recv()
                        auth_data = json.loads(auth_raw)
                        if "error" in auth_data:
                            self.on_log(f"Auth note: {auth_data['error'].get('message')} (continuing public ticks)")
                        elif "authorize" in auth_data and self.mode == "REAL":
                            bal = auth_data["authorize"].get("balance")
                            if isinstance(bal, (int, float)):
                                self.balance = float(bal)

                    await ws.send(json.dumps({"ticks": self.symbol, "subscribe": 1}))
                    tick_counter = 0

                    while self.running:
                        raw = await asyncio.wait_for(ws.recv(), timeout=15)
                        data = json.loads(raw)
                        if "tick" in data and "quote" in data["tick"]:
                            quote = float(data["tick"]["quote"])
                            self.ticks.append(quote)
                            if len(self.ticks) > 250:
                                self.ticks = self.ticks[-250:]
                            tick_counter += 1

                            rsi = calc_rsi(self.ticks, 14)
                            if rsi is not None and tick_counter % 8 == 0:
                                if rsi < 32:
                                    await self.execute_multiplier_trade("MULTUP", quote)
                                elif rsi > 68:
                                    await self.execute_multiplier_trade("MULTDOWN", quote)

                            self.on_update()
            except asyncio.CancelledError:
                break
            except Exception as exc:
                self.on_log(f"WS reconnect after error: {exc}")
                await asyncio.sleep(3)

        self.on_log("Engine stopped.")
        self.on_update()

    def start(self):
        if not self.running:
            self.running = True
            self._task = asyncio.create_task(self._stream_loop())
            self.on_update()

    def stop(self):
        self.running = False
        if self._task and not self._task.done():
            self._task.cancel()
        self.on_update()


def main(page: ft.Page):
    page.title = "Trader Skill AI — Cyber Bull"
    page.bgcolor = "#07090F"
    page.theme_mode = ft.ThemeMode.DARK
    page.padding = 12
    page.scroll = ft.ScrollMode.AUTO

    lang_state = {"ar": True}

    BG_DARK = "#07090F"
    CARD_BG = "#0E1320"
    BORDER_CYAN = "#00F5D4"
    ACCENT_PURPLE = "#9B5DE5"
    ACCENT_GREEN = "#00E676"
    ACCENT_RED = "#FF3B5C"
    TEXT_MUTED = "#8B9BB4"

    logs: list[str] = [f"[{datetime.now().strftime('%H:%M:%S')}] Cyber Bull initialized (DEMO mode)."]

    def push_log(entry: str):
        stamp = datetime.now().strftime("%H:%M:%S")
        logs.insert(0, f"[{stamp}] {entry}")
        logs[:] = logs[:40]
        refresh_ui()

    engine = TraderSkillEngine(on_update=lambda: refresh_ui(), on_log=push_log)

    lbl_title = ft.Text("TRADER SKILL AI • CYBER BULL", size=20, weight=ft.FontWeight.BOLD, color=BORDER_CYAN)
    lbl_sub = ft.Text("Deriv WS v3 • Multipliers & Risk Engine", size=12, color=TEXT_MUTED)

    kpi_price = ft.Text("---", size=18, weight=ft.FontWeight.BOLD, color="#FFFFFF")
    kpi_balance = ft.Text(f"${engine.balance:,.2f}", size=18, weight=ft.FontWeight.BOLD, color=ACCENT_GREEN)
    kpi_pnl = ft.Text("$0.00", size=18, weight=ft.FontWeight.BOLD, color=BORDER_CYAN)
    kpi_ind = ft.Text("EMA9: -- | RSI14: --", size=12, color=ACCENT_PURPLE)

    dd_platform = ft.Dropdown(
        label="Platform / المنصة",
        value="Deriv",
        options=[
            ft.dropdown.Option("Deriv"),
            ft.dropdown.Option("MT5"),
            ft.dropdown.Option("Binance"),
            ft.dropdown.Option("Quotex"),
        ],
        bgcolor=CARD_BG,
        border_color=BORDER_CYAN,
    )
    dd_symbol = ft.Dropdown(
        label="Symbol / الأصل",
        value="R_100",
        options=[
            ft.dropdown.Option("R_100"),
            ft.dropdown.Option("R_75"),
            ft.dropdown.Option("1HZ100V"),
            ft.dropdown.Option("EURUSD"),
            ft.dropdown.Option("BTCUSD"),
        ],
        bgcolor=CARD_BG,
        border_color=BORDER_CYAN,
    )
    dd_mode = ft.Dropdown(
        label="Account Mode / الوضع",
        value="DEMO",
        options=[
            ft.dropdown.Option("DEMO"),
            ft.dropdown.Option("REAL"),
        ],
        bgcolor=CARD_BG,
        border_color=ACCENT_PURPLE,
    )

    tf_token = ft.TextField(label="Deriv API Token", password=True, can_reveal_password=True, bgcolor=CARD_BG)
    tf_stake = ft.TextField(label="Stake ($)", value="25", bgcolor=CARD_BG)
    tf_mult = ft.TextField(label="Multiplier", value="100", bgcolor=CARD_BG)
    tf_sl = ft.TextField(label="Stop Loss ($)", value="10", bgcolor=CARD_BG)
    tf_tp = ft.TextField(label="Take Profit ($)", value="25", bgcolor=CARD_BG)
    tf_loss_cap = ft.TextField(label="Daily Loss Cap ($)", value="250", bgcolor=CARD_BG)
    tf_profit_tgt = ft.TextField(label="Daily Profit Target ($)", value="500", bgcolor=CARD_BG)
    tf_tg_token = ft.TextField(label="Telegram Bot Token", password=True, bgcolor=CARD_BG)
    tf_tg_chat = ft.TextField(label="Telegram Chat ID", bgcolor=CARD_BG)

    log_column = ft.Column(spacing=4, scroll=ft.ScrollMode.AUTO, height=160)

    def sync_inputs():
        engine.platform = dd_platform.value or "Deriv"
        engine.symbol = dd_symbol.value or "R_100"
        engine.mode = dd_mode.value or "DEMO"
        engine.api_token = (tf_token.value or "").strip()
        engine.tg_token = (tf_tg_token.value or "").strip()
        engine.tg_chat_id = (tf_tg_chat.value or "").strip()

        def safe_float(val: str, fallback: float) -> float:
            try:
                v = float(val)
                return v if v > 0 else fallback
            except Exception:
                return fallback

        def safe_int(val: str, fallback: int) -> int:
            try:
                v = int(float(val))
                return v if v > 0 else fallback
            except Exception:
                return fallback

        engine.stake = safe_float(tf_stake.value or "", 25.0)
        engine.multiplier = safe_int(tf_mult.value or "", 100)
        engine.sl_amount = safe_float(tf_sl.value or "", 10.0)
        engine.tp_amount = safe_float(tf_tp.value or "", 25.0)
        engine.daily_loss_cap = safe_float(tf_loss_cap.value or "", 250.0)
        engine.daily_profit_target = safe_float(tf_profit_tgt.value or "", 500.0)

    def refresh_ui():
        is_ar = lang_state["ar"]
        page.rtl = is_ar

        last_price = engine.ticks[-1] if engine.ticks else None
        ema9 = calc_ema(engine.ticks, 9)
        rsi14 = calc_rsi(engine.ticks, 14)
        bb_up, bb_mid, bb_low = calc_bollinger(engine.ticks, 20, 2.0)

        kpi_price.value = f"{last_price:.5f}" if isinstance(last_price, float) else "---"
        kpi_balance.value = f"${engine.balance:,.2f}"
        kpi_pnl.value = f"${engine.daily_pnl:+.2f}"
        kpi_pnl.color = ACCENT_GREEN if engine.daily_pnl >= 0 else ACCENT_RED
        kpi_ind.value = (
            f"EMA9: {ema9 if ema9 is not None else '--'} | "
            f"RSI14: {rsi14 if rsi14 is not None else '--'} | "
            f"BB: {bb_low if bb_low is not None else '--'}/{bb_mid if bb_mid is not None else '--'}/{bb_up if bb_up is not None else '--'}"
        )

        log_column.controls = [
            ft.Text(line, size=11, color=BORDER_CYAN if "PnL: +" in line else TEXT_MUTED)
            for line in logs
        ]
        page.update()

    def on_start_click(_):
        sync_inputs()
        engine.start()

    def on_stop_click(_):
        engine.stop()

    def on_manual_up(_):
        sync_inputs()
        p = engine.ticks[-1] if engine.ticks else 100.0
        asyncio.create_task(engine.execute_multiplier_trade("MULTUP", p))

    def on_manual_down(_):
        sync_inputs()
        p = engine.ticks[-1] if engine.ticks else 100.0
        asyncio.create_task(engine.execute_multiplier_trade("MULTDOWN", p))

    def on_toggle_lang(_):
        lang_state["ar"] = not lang_state["ar"]
        refresh_ui()

    btn_start = ft.ElevatedButton(
        "START BOT / تشغيل",
        bgcolor=ACCENT_GREEN,
        color="#000000",
        on_click=on_start_click,
    )
    btn_stop = ft.ElevatedButton(
        "STOP / إيقاف",
        bgcolor=ACCENT_RED,
        color="#FFFFFF",
        on_click=on_stop_click,
    )
    btn_up = ft.ElevatedButton(
        "MULT UP ▲",
        bgcolor=BORDER_CYAN,
        color="#000000",
        on_click=on_manual_up,
    )
    btn_down = ft.ElevatedButton(
        "MULT DOWN ▼",
        bgcolor=ACCENT_PURPLE,
        color="#FFFFFF",
        on_click=on_manual_down,
    )
    btn_lang = ft.OutlinedButton(
        "AR / EN",
        on_click=on_toggle_lang,
    )

    def card_box(content_ctrl):
        return ft.Container(
            content=content_ctrl,
            bgcolor=CARD_BG,
            padding=12,
            border_radius=12,
            border=ft.border.all(1, "#1D273B"),
        )

    page.add(
        card_box(
            ft.Row(
                [
                    ft.Column([lbl_title, lbl_sub], spacing=2, expand=True),
                    btn_lang,
                ],
                alignment=ft.MainAxisAlignment.SPACE_BETWEEN,
            )
        ),
        ft.ResponsiveRow(
            [
                ft.Container(
                    content=card_box(ft.Column([ft.Text("LIVE TICK", size=11, color=TEXT_MUTED), kpi_price], spacing=2)),
                    col={"xs": 6, "sm": 4},
                ),
                ft.Container(
                    content=card_box(ft.Column([ft.Text("BALANCE", size=11, color=TEXT_MUTED), kpi_balance], spacing=2)),
                    col={"xs": 6, "sm": 4},
                ),
                ft.Container(
                    content=card_box(ft.Column([ft.Text("DAILY P&L", size=11, color=TEXT_MUTED), kpi_pnl], spacing=2)),
                    col={"xs": 12, "sm": 4},
                ),
            ]
        ),
        card_box(kpi_ind),
        card_box(
            ft.Column(
                [
                    ft.ResponsiveRow(
                        [
                            ft.Container(dd_platform, col={"xs": 12, "sm": 4}),
                            ft.Container(dd_symbol, col={"xs": 12, "sm": 4}),
                            ft.Container(dd_mode, col={"xs": 12, "sm": 4}),
                        ]
                    ),
                    tf_token,
                    ft.ResponsiveRow(
                        [
                            ft.Container(tf_stake, col={"xs": 6, "sm": 3}),
                            ft.Container(tf_mult, col={"xs": 6, "sm": 3}),
                            ft.Container(tf_sl, col={"xs": 6, "sm": 3}),
                            ft.Container(tf_tp, col={"xs": 6, "sm": 3}),
                        ]
                    ),
                    ft.ResponsiveRow(
                        [
                            ft.Container(tf_loss_cap, col={"xs": 6}),
                            ft.Container(tf_profit_tgt, col={"xs": 6}),
                        ]
                    ),
                    ft.ResponsiveRow(
                        [
                            ft.Container(tf_tg_token, col={"xs": 12, "sm": 6}),
                            ft.Container(tf_tg_chat, col={"xs": 12, "sm": 6}),
                        ]
                    ),
                ],
                spacing=10,
            )
        ),
        ft.Row([btn_start, btn_stop, btn_up, btn_down], wrap=True, spacing=8),
        card_box(
            ft.Column(
                [
                    ft.Text("EXECUTION & RISK LOG", size=12, weight=ft.FontWeight.BOLD, color=BORDER_CYAN),
                    log_column,
                ],
                spacing=6,
            )
        ),
    )

    refresh_ui()


if __name__ == "__main__":
    ft.app(target=main)
