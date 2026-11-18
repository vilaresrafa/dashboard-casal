"""
Gera os ícones do app (site/icones/) e fotos de exemplo para o ambiente local (ferramentas/amostras/).
Uso: python ferramentas/gerar-imagens.py   (precisa do Pillow: pip install pillow)
"""
import math
import os

from PIL import Image, ImageDraw, ImageFilter

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ICONES = os.path.join(RAIZ, "site", "icones")
AMOSTRAS = os.path.join(RAIZ, "ferramentas", "amostras")

CREME = (255, 246, 238)
MENTA = (134, 211, 185)
PESSEGO = (255, 180, 143)
BRANCO = (255, 255, 255)


def coracao(cx, cy, escala, passos=240):
    """Pontos de um coração (curva paramétrica clássica)."""
    pts = []
    for i in range(passos):
        t = 2 * math.pi * i / passos
        x = 16 * math.sin(t) ** 3
        y = 13 * math.cos(t) - 5 * math.cos(2 * t) - 2 * math.cos(3 * t) - math.cos(4 * t)
        pts.append((cx + x * escala, cy - y * escala))
    return pts


def desenhar_icone(lado, margem_segura=False):
    s = 4  # superamostragem para bordas suaves
    L = lado * s
    img = Image.new("RGB", (L, L), CREME)
    d = ImageDraw.Draw(img)
    fator = 0.56 if margem_segura else 0.68
    esc = L * fator / 40
    contorno = esc * 1.6
    # coração menta (atrás, à esquerda) e pêssego (na frente, à direita)
    c1 = coracao(L * 0.41, L * 0.47, esc)
    c2 = coracao(L * 0.585, L * 0.56, esc)
    d.polygon(c1, fill=MENTA)
    # contorno branco do coração da frente, para separar os dois
    d.polygon(coracao(L * 0.585, L * 0.56, esc + contorno / 12), fill=BRANCO)
    d.polygon(c2, fill=PESSEGO)
    return img.resize((lado, lado), Image.LANCZOS)


def gerar_icones():
    os.makedirs(ICONES, exist_ok=True)
    desenhar_icone(192).save(os.path.join(ICONES, "icone-192.png"))
    desenhar_icone(512).save(os.path.join(ICONES, "icone-512.png"))
    desenhar_icone(512, margem_segura=True).save(os.path.join(ICONES, "icone-maskable-512.png"))
    desenhar_icone(180, margem_segura=True).save(os.path.join(ICONES, "apple-touch-icon.png"))
    desenhar_icone(32).save(os.path.join(ICONES, "favicon-32.png"))


def degrade(w, h, cima, baixo):
    img = Image.new("RGB", (w, h))
    d = ImageDraw.Draw(img)
    for y in range(h):
        f = y / (h - 1)
        cor = tuple(int(cima[i] + (baixo[i] - cima[i]) * f) for i in range(3))
        d.line([(0, y), (w, y)], fill=cor)
    return img


def cena(w, h, ceu_cima, ceu_baixo, sol, morros, extra=None):
    img = degrade(w, h, ceu_cima, ceu_baixo)
    d = ImageDraw.Draw(img)
    sx, sy, sr = sol[0] * w, sol[1] * h, sol[2] * w
    d.ellipse([sx - sr, sy - sr, sx + sr, sy + sr], fill=sol[3])
    for altura, cor, fase in morros:
        pts = [(0, h)]
        for x in range(0, w + 1, 8):
            y = h * altura + math.sin(x / w * math.pi * 2 + fase) * h * 0.05
            pts.append((x, y))
        pts.append((w, h))
        d.polygon(pts, fill=cor)
    if extra:
        extra(d, w, h)
    return img.filter(ImageFilter.GaussianBlur(1))


def coracoes_no_ceu(d, w, h):
    for cx, cy, e, cor in [(0.2, 0.25, 3, (255, 214, 196)), (0.32, 0.18, 2, (255, 230, 220))]:
        d.polygon(coracao(cx * w, cy * h, e * w / 400), fill=cor)


def gerar_amostras():
    os.makedirs(AMOSTRAS, exist_ok=True)
    w, h = 1280, 960
    cenas = [
        cena(w, h, (255, 214, 186), (255, 240, 225), (0.72, 0.38, 0.09, (255, 170, 120)),
             [(0.62, (255, 196, 160), 0.3), (0.74, (240, 160, 130), 1.7), (0.86, (210, 130, 110), 3.1)], coracoes_no_ceu),
        cena(w, h, (200, 236, 225), (240, 250, 245), (0.25, 0.3, 0.07, (255, 236, 170)),
             [(0.6, (160, 220, 196), 1.0), (0.72, (120, 196, 168), 2.4), (0.85, (90, 170, 140), 0.2)]),
        cena(w, h, (196, 220, 245), (250, 236, 220), (0.55, 0.5, 0.12, (255, 200, 150)),
             [(0.66, (180, 200, 230), 2.0), (0.78, (150, 175, 215), 0.6), (0.9, (120, 150, 200), 2.9)]),
    ]
    for i, img in enumerate(cenas, start=1):
        img.save(os.path.join(AMOSTRAS, f"foto{i}.jpg"), quality=82)
        mini = img.copy()
        mini.thumbnail((360, 360))
        mini.save(os.path.join(AMOSTRAS, f"foto{i}_mini.jpg"), quality=70)


if __name__ == "__main__":
    gerar_icones()
    gerar_amostras()
    print("ok: ícones em", ICONES, "e amostras em", AMOSTRAS)
