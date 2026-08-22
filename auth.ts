import { TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions";
import readline from "readline/promises";

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

const apiId = Number(process.env.TG_API_ID);
const apiHash = process.env.TG_API_HASH;

if (!apiId || !apiHash) {
  console.log("\n⚠️ Ошибка: Сначала укажите TG_API_ID и TG_API_HASH в файле .env");
  console.log("Получить их можно на сайте: https://my.telegram.org (раздел 'API development tools')\n");
  process.exit(1);
}

const client = new TelegramClient(new StringSession(""), apiId, apiHash, {
  connectionRetries: 5,
});

async function main() {
  await client.start({
    phoneNumber: async () =>
      await rl.question("Введите ваш номер телефона (с +7/etc): "),
    password: async () =>
      await rl.question(
        "Введите 2FA пароль (если включен, иначе нажмите Enter): ",
      ),
    phoneCode: async () =>
      await rl.question("Введите код авторизации из Telegram: "),
    onError: (err) => console.log(err),
  });

  console.log("\nУспешная авторизация!");
  console.log(
    "Скопируйте эту строчку и добавьте её в .env как TG_STRING_SESSION:\n",
  );
  console.log(client.session.save());
  process.exit(0);
}

main();
