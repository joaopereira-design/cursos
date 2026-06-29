# Plataforma local de cursos do Telegram

Essa pasta virou uma biblioteca local para organizar aulas que estao perdidas nas mensagens de um canal do Telegram.

## Rodar a plataforma

No PowerShell, use:

```powershell
npm.cmd install
npm.cmd start
```

Depois abra:

```text
http://localhost:5173
```

## Importar o canal do Telegram

1. Crie um app em `https://my.telegram.org/apps` para pegar `api_id` e `api_hash`.
2. Copie `.env.example` para `.env`.
3. Preencha `TELEGRAM_API_ID`, `TELEGRAM_API_HASH` e mantenha o link do canal em `TELEGRAM_CHANNEL`.
4. Rode:

```powershell
npm.cmd run import:telegram
```

Na primeira vez ele vai pedir telefone, codigo do Telegram e senha 2FA se voce usar. Ao final, ele mostra uma `TELEGRAM_SESSION`; coloque esse valor no `.env` para nao precisar logar de novo.

Os videos baixados ficam em `media/telegram`, e o catalogo gerado fica em `data/catalog.json`.

## Varios canais/cursos

Agora voce tambem pode fazer isso pela tela da plataforma, no painel **Importacao**.

Para importar outro canal manualmente pelo `.env`, troque `TELEGRAM_CHANNEL` e, se quiser controlar o nome/pasta do curso, preencha:

```env
TELEGRAM_COURSE_ID=auto-hipnose-kraisch
TELEGRAM_COURSE_TITLE=Auto-Hipnose Metodo Kraisch
```

Cada `TELEGRAM_COURSE_ID` vira:

- um curso separado na plataforma;
- uma pasta separada em `media/telegram/TELEGRAM_COURSE_ID`;
- um progresso de importacao separado em `data/import-progress-TELEGRAM_COURSE_ID.json`.

O `data/catalog.json` guarda todos os cursos. Quando voce roda o importador de novo com o mesmo `TELEGRAM_COURSE_ID`, ele atualiza apenas aquele curso.

Pela tela, essas preferencias ficam em `data/import-config.json`.

O importador tenta entender o padrao dos canais de curso:

- usa tags como `#F01`, `#F02`, `#F40` para ordenar e nomear aulas;
- le mensagens de sumario com linhas tipo `= 01 - Modulo 01` para preencher o modulo da aula;
- baixa documentos e materiais alem dos videos;
- mostra materiais como links dentro da plataforma.

Para baixar mais rapido, ajuste no `.env`:

```env
DOWNLOAD_CONCURRENCY=3
```

Use `3` ou `4` como ponto de partida. Valores muito altos podem fazer o Telegram limitar ou derrubar downloads.

Para ver o andamento:

```powershell
npm.cmd run progress
```

## Onde fica salvo

- Cursos e aulas: `data/catalog.json`
- Configuracao da tela de importacao: `data/import-config.json`
- Progresso da importacao atual: `data/import-progress.json`
- Progresso por curso importado: `data/import-progress-NOME-DO-CURSO.json`
- Progresso de aulas vistas: `data/watch-progress.json` e tambem no navegador
- Videos e materiais: `media/telegram/NOME-DO-CURSO`

## Google Drive

Para usar o Google Drive como armazenamento:

1. Crie credenciais OAuth no Google Cloud Console.
2. Configure no `.env`:

```env
GOOGLE_DRIVE_CLIENT_ID=...
GOOGLE_DRIVE_CLIENT_SECRET=...
GOOGLE_DRIVE_REDIRECT_URI=http://localhost:5173/api/drive/callback
```

3. Reinicie o servidor com `npm.cmd start`.
4. Abra a plataforma, clique em **Importacao** e depois **Conectar Google Drive**.
5. Em **Armazenamento**, escolha `Google Drive` ou `Local + Drive`.

Quando uma aula vai para o Drive, o catalogo salva `driveFileId`, `driveWebViewLink` e `drivePreviewUrl`. A plataforma usa o preview embutido do Drive para tocar o video dentro do sistema.

## Supabase

O Supabase pode guardar o catalogo, progresso dos usuarios e o token do Google Drive usado pelo servidor.

1. No painel da Supabase, abra **SQL Editor**.
2. Rode o arquivo `supabase/schema.sql`.
3. Configure no `.env`:

```env
SUPABASE_PROJECT_ID=
SUPABASE_URL=
SUPABASE_PUBLISHABLE_KEY=
SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
```

4. Migre os dados locais:

```powershell
npm.cmd run migrate:supabase
```

Depois disso, o app carrega `/api/catalog` pelo Supabase. Se o banco estiver fora ou ainda sem tabela, ele cai automaticamente no `data/catalog.json` local.

Para producao na Vercel, configure pelo menos `SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY` como variaveis sensiveis do projeto.

## Deploy na Vercel

O deploy na Vercel nao envia `media/telegram`, `.env`, tokens, logs ou progresso local. A Vercel fica como visualizador web do catalogo.

Arquivos bloqueados no deploy:

- `media/`
- `.env`
- `data/import-config.json`
- `data/import-progress*.json`
- `data/import-run.log`
- `data/watch-progress.json`
- `data/google-drive-token.json`

Para assistir na Vercel, prefira aulas com `drivePreviewUrl` no `data/catalog.json`, usando o modo Google Drive.

## Editar manualmente

Se quiser organizar por cursos/modulos antes de automatizar melhor, edite `data/catalog.json`. O formato de exemplo esta em `data/catalog.sample.json`.
