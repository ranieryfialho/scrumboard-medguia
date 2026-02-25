import { google } from 'googleapis';
import { NextResponse } from 'next/server';

// ==========================================
// FUNÇÃO AUXILIAR: BUSCAR E MAPEAR DADOS
// ==========================================
// Adicionamos 'rangeName' para podermos buscar em abas específicas (ex: Página1, Página2)
async function fetchSheetData(sheets: any, spreadsheetId: string, sheetAlias: string, rangeName: string) {
  try {
    const response = await sheets.spreadsheets.values.get({ spreadsheetId, range: rangeName });
    const rows = response.data.values;
    
    if (!rows || rows.length === 0) return [];

    const headers = rows[0].map((header: any) => 
      header.toString().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim()
    );

    return rows.slice(1).map((row: any[], index: number) => {
      // O ID agora avisa a Planilha E a Aba! Ex: sheet1_Página2-lead-5
      const leadData: any = { id: `${sheetAlias}_${rangeName}-lead-${index}` };

      headers.forEach((header: string, colIndex: number) => {
        if (header === 'id') leadData['meta_id'] = row[colIndex] || '';
        else leadData[header] = row[colIndex] || '';
      });

      // MAPEAMENTO INTELIGENTE (Cobre todas as variações das BMs)
      leadData.nome = leadData['full name'] || leadData['first name'] || leadData['company_name'] || 'Sem Nome';
      leadData.cargo = leadData['qual_a_sua_especialidade_medica?'] || leadData['qual_a_sua_especialidade?'] || leadData['full_name'] || '';
      leadData.whatsapp = leadData['telefone'] || leadData['qual_seu_numero_de_whatsapp?'] || leadData['phone_number'] || '';
      leadData.email = leadData['email'] || '';
      
      if (leadData['qual_o_numero_do_seu_crm?']) {
        leadData.tipo = `CRM: ${leadData['qual_o_numero_do_seu_crm?']}`;
      }
      
      leadData.situacao = leadData['lead_status'] || 'Sem situação';

      return leadData;
    });
  } catch (error) {
    console.error(`Erro ao buscar dados da planilha ${sheetAlias} aba ${rangeName}:`, error);
    return []; // Retorna array vazio se der erro, para não quebrar as outras abas
  }
}

// ==========================================
// ROTA GET: LER AS PLANILHAS E REMOVER DUPLICADAS
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
    
    const id1 = process.env.GOOGLE_SHEET_ID_1;
    const id2 = process.env.GOOGLE_SHEET_ID_2;
    const id3 = process.env.GOOGLE_SHEET_ID_3;

    if (!id1 || !id2 || !id3) {
      return NextResponse.json({ error: 'Faltam os IDs das planilhas no .env.local' }, { status: 500 });
    }

    // Busca as QUATRO abas simultaneamente (muito mais rápido)
    const [leadsBM1_Pag1, leadsBM1_Pag2, leadsBM2, leadsBM3] = await Promise.all([
      fetchSheetData(sheets, id1, 'sheet1', 'Página1'), // Primeira planilha, Página 1
      fetchSheetData(sheets, id1, 'sheet1', 'Página2'), // Primeira planilha, Página 2
      fetchSheetData(sheets, id2, 'sheet2', 'Página1'), // Segunda planilha
      fetchSheetData(sheets, id3, 'sheet3', 'Página1')  // Terceira planilha
    ]);

    // Junta tudo num array só
    const todosLeads = [...leadsBM1_Pag1, ...leadsBM1_Pag2, ...leadsBM2, ...leadsBM3];

    // ==========================================
    // LÓGICA ANTI-DUPLICIDADE
    // ==========================================
    const leadsUnicos: any[] = [];
    const telefonesVistos = new Set<string>();
    const emailsVistos = new Set<string>();

    todosLeads.forEach(lead => {
      const telefoneLimpo = lead.whatsapp ? lead.whatsapp.replace(/\D/g, '') : null;
      const emailLimpo = lead.email ? lead.email.toLowerCase().trim() : null;

      let ehDuplicado = false;

      if (telefoneLimpo && telefonesVistos.has(telefoneLimpo)) ehDuplicado = true;
      if (emailLimpo && emailsVistos.has(emailLimpo)) ehDuplicado = true;

      if (!ehDuplicado) {
        if (telefoneLimpo) telefonesVistos.add(telefoneLimpo);
        if (emailLimpo) emailsVistos.add(emailLimpo);
        leadsUnicos.push(lead);
      }
    });

    return NextResponse.json(leadsUnicos);
    
  } catch (error) {
    console.error("Erro ao acessar o Sheets:", error);
    return NextResponse.json({ error: 'Erro ao acessar dados.' }, { status: 500 });
  }
}

// ==========================================
// ROTA POST: SALVAR NOVA SITUAÇÃO NA PLANILHA E ABA CERTAS
// ==========================================
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { id, novaSituacao } = body;

    if (!id || !novaSituacao) return NextResponse.json({ error: 'Faltam dados' }, { status: 400 });

    // O ID "sheet1_Página2-lead-5" é quebrado para sabermos a planilha, a aba e a linha
    const parts = id.split('-lead-');
    if (parts.length !== 2) throw new Error('ID inválido');
    
    // Quebra o prefixo "sheet1_Página2"
    const aliasERange = parts[0].split('_'); 
    const sheetAlias = aliasERange[0]; // "sheet1"
    const rangeName = aliasERange[1] || 'Página1'; // "Página2" (ou Página1 se não encontrar)

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
    
    // Roteador de Planilhas: Qual das 3 ele vai atualizar?
    let spreadsheetId = '';
    if (sheetAlias === 'sheet1') spreadsheetId = process.env.GOOGLE_SHEET_ID_1!;
    else if (sheetAlias === 'sheet2') spreadsheetId = process.env.GOOGLE_SHEET_ID_2!;
    else if (sheetAlias === 'sheet3') spreadsheetId = process.env.GOOGLE_SHEET_ID_3!;

    // Puxa a linha 1 DA ABA CORRETA para achar onde está a coluna de Status
    const headerResponse = await sheets.spreadsheets.values.get({
      spreadsheetId, range: `${rangeName}!1:1`,
    });

    const headers = headerResponse.data.values?.[0] || [];
    const normalizedHeaders = headers.map((h: any) => 
      h.toString().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim()
    );
    
    let statusColIndex = normalizedHeaders.indexOf('lead_status');
    if (statusColIndex === -1) statusColIndex = normalizedHeaders.indexOf('situacao');
    if (statusColIndex === -1) statusColIndex = headers.length; 

    let colLetter = '';
    let tempColIndex = statusColIndex;
    while (tempColIndex >= 0) {
      colLetter = String.fromCharCode((tempColIndex % 26) + 65) + colLetter;
      tempColIndex = Math.floor(tempColIndex / 26) - 1;
    }

    // A célula final a ser atualizada será algo como "Página2!Q7"
    const cellRange = `${rangeName}!${colLetter}${sheetRow}`;

    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: cellRange,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: [[novaSituacao]] },
    });

    return NextResponse.json({ success: true, range: cellRange, novaSituacao });

  } catch (error) {
    console.error("Erro ao salvar no Sheets:", error);
    return NextResponse.json({ error: 'Erro interno ao salvar.' }, { status: 500 });
  }
}