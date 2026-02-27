
import { google } from 'googleapis';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

async function getSheetsClient() {
  const auth = new google.auth.GoogleAuth({
    credentials: {
      client_email: process.env.GOOGLE_CLIENT_EMAIL,
      private_key: process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    },
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  return google.sheets({ version: 'v4', auth });
}

const SPREADSHEET_ID = process.env.GOOGLE_SHEET_ID_1;
const RANGE_NAME = 'Agenda';

export async function GET() {
  try {
    const sheets = await getSheetsClient();
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `${RANGE_NAME}!A:D`,
    });

    const rows = response.data.values || [];
    
    const eventos = rows.slice(1).map(row => ({
      id: row[0] || '',
      date: row[1] || '',
      title: row[2] || '',
      time: row[3] || '',
      type: 'reuniao'
    })).filter(e => e.id !== '');

    return NextResponse.json(eventos);
  } catch (error) {
    console.error('Erro ao buscar agenda:', error);
    return NextResponse.json({ error: 'Erro ao buscar agenda' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { action, evento, id } = body;
    const sheets = await getSheetsClient();

    if (action === 'create' && evento) {
      const newRow = [evento.id, evento.date, evento.title, evento.time];
      await sheets.spreadsheets.values.append({
        spreadsheetId: SPREADSHEET_ID,
        range: `${RANGE_NAME}!A:D`,
        valueInputOption: 'USER_ENTERED',
        insertDataOption: 'INSERT_ROWS',
        requestBody: { values: [newRow] },
      });
      return NextResponse.json({ success: true });
    }

    if (action === 'delete' && id) {
      const response = await sheets.spreadsheets.values.get({
        spreadsheetId: SPREADSHEET_ID,
        range: `${RANGE_NAME}!A:A`,
      });
      const rows = response.data.values || [];
      const rowIndex = rows.findIndex(row => row[0] === id);
      
      if (rowIndex !== -1) {
        const sheetRow = rowIndex + 1;
        await sheets.spreadsheets.values.clear({
          spreadsheetId: SPREADSHEET_ID,
          range: `${RANGE_NAME}!A${sheetRow}:D${sheetRow}`,
        });
      }
      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ error: 'Ação inválida' }, { status: 400 });
  } catch (error) {
    console.error('Erro ao modificar agenda:', error);
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 });
  }
}