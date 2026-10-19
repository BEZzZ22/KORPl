# Dota-тренер для Telegram

Бот разбирает твои матчи в Dota 2: где ошибся, что получилось и над чем работать.
Данные берёт из OpenDota, а если задан ключ Anthropic, Claude дополнительно пишет разбор как тренер.

## Запуск

```bash
python -m venv .venv
source .venv/bin/activate        # Windows: .venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env             # и впиши BOT_TOKEN от @BotFather
python bot.py
```

## Команды

- `/me <Friend ID>` — привязать аккаунт Доты
- `/last` — разобрать последний матч
- ID матча или ссылка — разобрать конкретный матч

В настройках Доты должна быть включена публичная статистика матчей, иначе OpenDota не увидит игры.
