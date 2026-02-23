import { google } from 'googleapis';

export function getGoogleSheetsClient() {
  const clientEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  let privateKey = process.env.GOOGLE_PRIVATE_KEY;

  if (!clientEmail || !privateKey) {
    throw new Error('Variáveis de ambiente do Google não encontradas.');
  }

  // Tratamento definitivo para o erro de DECODER
  // 1. Remove aspas extras no início/fim
  // 2. Transforma a string literal "\n" em quebras de linha reais
  // 3. Garante que não existam espaços em branco extras
  const formattedKey = privateKey
    .trim()
    .replace(/^['"]|['"]$/g, '')
    .replace(/\\n/g, '\n');

  try {
    const auth = new google.auth.GoogleAuth({
      credentials: {
        client_email: clientEmail,
        private_key: formattedKey,
      },
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });

    return google.sheets({ version: 'v4', auth });
  } catch (err) {
    console.error('Erro ao inicializar Google Auth:', err);
    throw err;
  }
}