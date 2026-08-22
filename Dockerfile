FROM oven/bun:1.3.14-slim

WORKDIR /app

# Копируем файлы зависимостей для кеширования слоёв
COPY package.json bun.lock* ./

# Устанавливаем зависимости
RUN bun install --frozen-lockfile || bun install

# Копируем исходный код
COPY . .

# Создаём директорию для логов
RUN mkdir -p /app/logs

CMD ["bun", "run", "index.ts"]
