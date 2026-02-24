import { google } from 'googleapis';
import { NextResponse } from 'next/server';

// ==========================================
// FUNÇÃO AUXILIAR: BUSCAR E MAPEAR DADOS
// ==========================================
async function fetchSheetData(sheets: any, spreadsheetId: string, range: string) {
  const response = await sheets.spreadsheets.values.get({ spreadsheetId, range });
  const rows = response.data.values;
  
  if (!rows || rows.length === 0) return [];

  const headers = rows[0].map((header: any) => 
    header.toString()
      .toLowerCase()
      .normalize("NFD").replace(/[\u0300-\u036f]/g, "") 
      .trim()
  );

  return rows.slice(1).map((row: any[], index: number) => {
    const leadData: any = {
      id: `${range.toLowerCase()}-lead-${index}`, 
    };

    headers.forEach((header: string, colIndex: number) => {
      if (header === 'id') {
        leadData['meta_id'] = row[colIndex] || '';
      } else {
        leadData[header] = row[colIndex] || '';
      }
    });

    // ==========================================
    // MAPEAMENTO EXATO (Ajustado para a base Meta Ads)
    // ==========================================
    
    // NOME: company_name (Pág 1) ou first name (Pág 2)
    leadData.nome = leadData['company_name'] || leadData['first name'] || 'Sem Nome';
    
    // ESPECIALIDADE: full_name (Pág 1) ou qual_a_sua_especialidade? (Pág 2)
    leadData.cargo = leadData['full_name'] || leadData['qual_a_sua_especialidade?'] || '';
    
    // TELEFONE: phone_number (Pág 1) ou qual_seu_numero_de_whatsapp? (Pág 2)
    leadData.whatsapp = leadData['phone_number'] || leadData['qual_seu_numero_de_whatsapp?'] || '';

    // E-MAIL: presente em ambas
    leadData.email = leadData['email'] || '';

    // CRM: se existir (Pág 2)
    if (leadData['qual_o_numero_do_seu_crm?']) {
      leadData.tipo = `CRM: ${leadData['qual_o_numero_do_seu_crm?']}`;
    }

    // SITUAÇÃO: status do lead
    leadData.situacao = leadData['lead_status'] || 'Sem situação';

    return leadData;
  });
}

// ==========================================
// ROTA GET: LER A PLANILHA
// ==========================================
export async function GET() {
  try {
    const auth = new google.auth.GoogleAuth({
      credentials: {
        client_email: process.env.GOOGLE_CLIENT_EMAIL,
        private_key: process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
      },
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });

    const sheets = google.sheets({ version: 'v4', auth });
    const spreadsheetId = process.env.GOOGLE_SHEET_ID;

    if (!spreadsheetId) {
      return NextResponse.json({ error: 'Falta o ID da planilha.' }, { status: 500 });
    }

    const leadsPagina1 = await fetchSheetData(sheets, spreadsheetId, 'Página1');
    const leadsPagina2 = await fetchSheetData(sheets, spreadsheetId, 'Página2');

    const todosLeads = [...leadsPagina1, ...leadsPagina2];

    return NextResponse.json(todosLeads);
  } catch (error) {
    console.error("Erro ao acessar o Sheets:", error);
    return NextResponse.json({ error: 'Erro ao acessar dados.' }, { status: 500 });
  }
}

// ==========================================
// ROTA POST: SALVAR NOVA SITUAÇÃO NA PLANILHA
// ==========================================
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { id, novaSituacao } = body;

    if (!id || !novaSituacao) {
      return NextResponse.json({ error: 'Faltam dados' }, { status: 400 });
    }

    const parts = id.split('-lead-');
    if (parts.length !== 2) throw new Error('ID inválido');
    
    const rangeName = parts[0].replace('página', 'Página'); 
    const rowIndex = parseInt(parts[1], 10);
    const sheetRow = rowIndex + 2;

    const auth = new google.auth.GoogleAuth({
      credentials: {
        client_email: process.env.GOOGLE_CLIENT_EMAIL,
        private_key: process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
      },
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });

    const sheets = google.sheets({ version: 'v4', auth });
    const spreadsheetId = process.env.GOOGLE_SHEET_ID;

    const headerResponse = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `${rangeName}!1:1`,
    });

    const headers = headerResponse.data.values?.[0] || [];
    const normalizedHeaders = headers.map((h: any) => 
      h.toString().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim()
    );
    
    let statusColIndex = normalizedHeaders.indexOf('lead_status');
    if (statusColIndex === -1) {
      statusColIndex = normalizedHeaders.indexOf('situacao');
    }

    if (statusColIndex === -1) {
       statusColIndex = headers.length; 
    }

    let colLetter = '';
    let tempColIndex = statusColIndex;
    while (tempColIndex >= 0) {
      colLetter = String.fromCharCode((tempColIndex % 26) + 65) + colLetter;
      tempColIndex = Math.floor(tempColIndex / 26) - 1;
    }

    const cellRange = `${rangeName}!${colLetter}${sheetRow}`;

    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: cellRange,
      valueInputOption: 'USER_ENTERED',
      requestBody: {
        values: [[novaSituacao]],
      },
    });

    return NextResponse.json({ success: true, range: cellRange, novaSituacao });

  } catch (error) {
    console.error("Erro ao salvar no Sheets:", error);
    return NextResponse.json({ error: 'Erro interno ao salvar.' }, { status: 500 });
  }
}