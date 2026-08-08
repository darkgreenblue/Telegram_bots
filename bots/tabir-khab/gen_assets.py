"""اسکریپت یک‌بارمصرف — ساخت مسکاتِ «تعبیرکننده‌ی اعظم» و ذخیره در assets/.

اجرا:  python3 gen_assets.py
دو تصویر می‌سازد (حالت خوش‌آمد + حالت دعوت/دست‌دراز‌کرده) با یک شخصیتِ ثابت.
برای بازتولید دوباره، همین را اجرا کن (فایل‌ها بازنویسی می‌شوند).
"""
import os
import asyncio
import aiohttp

import ai
from config import ASSETS_DIR, MASCOT_WELCOME, MASCOT_INVITE

# توصیف شخصیتِ ثابت — برای حفظ هویتِ یکسان در هر دو تصویر
CHARACTER = (
    "The Grand Interpreter of Dreams: a wise ancient mystical sage, an elderly man with a long "
    "flowing silver beard and deep, knowing kind eyes, wearing a dark midnight-blue celestial "
    "robe and hood embroidered with glowing golden stars, crescent moons and constellations, "
    "an ethereal soft aura around him. Persian / Eastern mystical aesthetic, dignified and warm. "
    "Background: the dreamlike Realm of Dreams — deep indigo starry night sky, several glowing "
    "moons of different phases, floating luminous stars, soft volumetric light, gentle mystical fog. "
    "Surreal oil painting / cinematic digital art, highly detailed, painterly, 8k."
)

WELCOME_POSE = (
    "He looks directly and warmly toward the viewer with a gentle welcoming smile, one hand placed "
    "softly over his heart in a graceful gesture of greeting, inviting and reassuring."
)

INVITE_POSE = (
    "He extends one open hand directly toward the viewer, palm up, inviting them to take his hand, "
    "with a hopeful encouraging expression; behind him a luminous glowing portal and a shining path "
    "open into the deeper Realm of Dreams."
)


async def _download(url: str, dest: str):
    connector = aiohttp.TCPConnector(ssl=False)
    async with aiohttp.ClientSession(connector=connector) as s:
        async with s.get(url, timeout=aiohttp.ClientTimeout(total=120)) as r:
            r.raise_for_status()
            data = await r.read()
    with open(dest, "wb") as f:
        f.write(data)


async def _make(filename: str, pose: str):
    prompt = f"{CHARACTER}\n{pose}"
    print(f"→ generating {filename} …")
    url = (await ai.generate_image(prompt))["url"]
    dest = os.path.join(ASSETS_DIR, filename)
    await _download(url, dest)
    size = os.path.getsize(dest)
    print(f"  ✅ saved {dest} ({size//1024} KB)")


async def main():
    os.makedirs(ASSETS_DIR, exist_ok=True)
    await _make(MASCOT_WELCOME, WELCOME_POSE)
    await _make(MASCOT_INVITE, INVITE_POSE)
    print("\n✅ mascot assets ready in", ASSETS_DIR)


if __name__ == "__main__":
    asyncio.run(main())
