# Metadata for the 14 motion shorts: YouTube/TikTok queue entries (promo/yt_queue.json) and Instagram captions.
# python3 meta.py queue   -> appends the entries whose mp4 exists to KORPl/promo/yt_queue.json (copies the mp4)
# python3 meta.py insta   -> writes /mnt/project-files/instagram/pack-motion/podpisi.md and copies the mp4s
import json, shutil, sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

MOTION = Path('/mnt/project-files/youtube/motion')
KORPL = Path(__file__).resolve().parents[2]
BOT = 'Бот в Телеграме: @DotaRazbor_bot\nhttps://t.me/DotaRazbor_bot'
TAGS = ['dota 2', 'дота 2', 'dota2', 'shorts']

# id, title, description, extra tags, hashtags
FILMS = [
  ('spirit', 'Spirit — единственные с тремя Аегисами. Будет четвёртый? #Shorts',
   'Бухарест 2021, Сиэтл 2023, Шанхай 2026. Финал против Team Vision 3:2, пятая карта 64 минуты.', ['team spirit', 'yatoro', 'collapse', 'the international'], '#teamspirit #ti2026'),
  ('patch', 'Где патч 7.42? Valve молчат уже полгода #Shorts',
   'Последний патч — 7.41f от 15 сентября. Ни даты, ни анонса 7.42. Когда выйдет — пиши в комменты.', ['патч 7.42', 'dota 2 patch'], '#патч'),
  ('tier', 'Тир-лист самых бесячих героев Доты #Shorts',
   'Наш тир-лист: от «терпимо» до «выключаю игру». Кого забыли — пиши в комменты.', ['тир лист', 'techies', 'meepo'], '#тирлист'),
  ('horror', 'Страшилки для Стража. Смотреть с выключенным светом #Shorts',
   'Пять кошмаров любого Стража. А самое страшное — не знать, почему слил.', ['страж', 'мемы дота'], '#страж'),
  ('champs', 'Все чемпионы The International с 2011 по 2026 #Shorts',
   'От Na`Vi в 2011 до Spirit в 2026. Кто брал Аегис больше одного раза — в ролике.', ['the international', 'чемпионы ti', 'аегис'], '#ti #aegis'),
  ('guess', 'Угадай героя по трём предметам #Shorts',
   'Три раунда и бонус для самых умных. Сколько из четырёх угадал — пиши в комменты.', ['угадай героя', 'квиз дота'], '#квиз'),
  ('habits', '5 привычек, которые держат тебя в Страже #Shorts',
   'Сколько из пяти про тебя? Честно, в комменты.', ['страж', 'как поднять ммр'], '#ммр'),
  ('prize', 'Как упал призовой The International: с $40 млн до ≈$3 млн #Shorts',
   'Рекорд 2021 года — $40 018 195. После того как Valve убрали Батл Пасс, призовой рухнул.', ['призовой ti', 'battle pass'], '#ti'),
  ('dilemma', 'Выбери одно: 6 дилемм дотера #Shorts',
   'Запоминай свои буквы и пиши в комменты, например: АБАББА.', ['дилеммы', 'выбери одно'], '#выбор'),
  ('mapfails', '5 смертельных ошибок на карте в Доте #Shorts',
   'Из-за них ты и сидишь в Страже. Какая из пяти твоя — номер в комменты.', ['ошибки дота', 'карта дота'], '#гайд'),
  ('support', 'Какой ты саппорт? Тест за 20 секунд #Shorts',
   'Пять карточек — выбирай свою и отмечай своего саппорта.', ['саппорт', 'тест дота'], '#саппорт'),
  ('ranks', 'Все ранги Доты: от Рекрута до Титана #Shorts',
   'Титан — потолок, дальше только место в таблице лидеров. Пиши свой ранг в комменты.', ['ранги дота', 'титан', 'медали'], '#ранги'),
  ('botshow', 'Что бот найдёт в твоей катке #Shorts',
   'Оценка катки, кто слил, где ты умирал, игра по фазам, тренер и повтор на карте. Бесплатно.', ['разбор катки', 'бот дота'], '#разбор'),
  ('hours', '10 000 часов в Доте — это сколько? #Shorts',
   '416 дней без сна или 15 000 каток по 40 минут. А у тебя сколько часов?', ['10000 часов', 'часы в доте'], '#часы'),
]

MSK = timezone(timedelta(hours=3))
SLOTS = [datetime(2026, 11, 6 + d, h, 30, tzinfo=MSK) for d in range(7) for h in (12, 19)]


def entry(i, f):
    fid, title, desc, tags, ht = f
    return {'id': fid, 'at': SLOTS[i].isoformat(), 'video': f'promo/shorts/{fid}.mp4', 'title': title,
            'description': f'{desc}\n\n{BOT}\n\n#Shorts #dota2 #дота2 #доташка {ht}', 'tags': TAGS + tags}


def queue():
    p = KORPL / 'promo/yt_queue.json'
    q = json.loads(p.read_text(encoding='utf-8'))
    have = {x['id'] for x in q}
    for i, f in enumerate(FILMS):
        src = MOTION / f'{f[0]}.mp4'
        if f[0] in have or not src.exists():
            continue
        shutil.copy(src, KORPL / f'promo/shorts/{f[0]}.mp4')
        q.append(entry(i, f)); print('+', f[0], SLOTS[i])
    p.write_text(json.dumps(q, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')


def insta():
    out = Path('/mnt/project-files/instagram/pack-motion'); out.mkdir(parents=True, exist_ok=True)
    TOMSK = timezone(timedelta(hours=7))
    lines = ['# Моушн-ролики для Инсты: 14 штук, по 2 в день с 6 по 12 ноября', '',
             'Время указано по Томску (МСК+4). Ролик → подпись (скопируй целиком) → дата и время. Идут после основной пачки (она до 4.11).', '']
    for i, f in enumerate(FILMS):
        fid, title, desc, tags, ht = f
        src = MOTION / f'{fid}.mp4'
        n = f'{i + 1:02d}_{fid}.mp4'
        if src.exists():
            shutil.copy(src, out / n)
        t = SLOTS[i].astimezone(TOMSK)
        cap = title.replace(' #Shorts', '')
        lines += [f'## {i + 1}. {n} — {t:%d.%m} в {t:%H:%M} (Томск)', '', '```',
                  f'{cap}\n\n{desc}\n\nБот в Телеграме: @DotaRazbor_bot (ссылка в шапке профиля).\n\n#dota2 #дота2 #доташка #dota {ht} #ммр #геймер #киберспорт', '```', '']
    (out / 'podpisi.md').write_text('\n'.join(lines), encoding='utf-8')
    print(out)


if __name__ == '__main__':
    {'queue': queue, 'insta': insta}[sys.argv[1]]()
