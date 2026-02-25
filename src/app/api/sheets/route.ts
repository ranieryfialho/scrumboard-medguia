import { google } from 'googleapis';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

async function fetchSheetData(sheets: any, spreadsheetId: string, sheetAlias: string, rangeName: string) {
  try {
    const response = await sheets.spreadsheets.values.get({ spreadsheetId, range: rangeName });
    const rows = response.data.values;
    
    if (!rows || rows.length === 0) return [];

    const headers = rows[0].map((header: any) => 
      header ? header.toString().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim() : ''
    );

    return rows.slice(1).map((row: any[], index: number) => {
      const leadData: any = { id: `${sheetAlias}_${rangeName}-lead-${index}` };

      headers.forEach((header: string, colIndex: number) => {
        if (header === 'id') leadData['meta_id'] = row[colIndex] || '';
        else if (header) leadData[header] = row[colIndex] || '';
      });

      leadData.nome = leadData['full name'] || leadData['first name'] || leadData['company_name'] || leadData['nome'] || 'Sem Nome';
      leadData.cargo = leadData['qual_a_sua_especialidade_medica?'] || leadData['qual_a_sua_especialidade?'] || leadData['full_name'] || leadData['cargo'] || '';
      leadData.whatsapp = leadData['telefone'] || leadData['qual_seu_numero_de_whatsapp?'] || leadData['phone_number'] || leadData['whatsapp'] || '';
      leadData.email = leadData['email'] || '';
      
      leadData.created_time = leadData['created_time'] || leadData['created time'] || leadData['data de criacao'] || '';
      leadData.data_alteracao = leadData['data_alteracao'] || leadData['data de alteracao'] || '';
      
      leadData.observacoes = leadData['observacoes'] || leadData['observacao'] || '';
      leadData.origem = leadData['origem'] || '';

      if (leadData['qual_o_numero_do_seu_crm?']) {
        leadData.tipo = `CRM: ${leadData['qual_o_numero_do_seu_crm?']}`;
      }
      
      leadData.situacao = leadData['lead_status'] || leadData['situacao'] || 'Sem situação';

      return leadData;
    });
  } catch (error) {
    console.error(`Erro ao buscar dados da planilha ${sheetAlias} aba ${rangeName}:`, error);
    return []; 
  }
}

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
        return NextResponse.json({ error: 'Faltam IDs das planilhas nas variáveis de ambiente' }, { status: 500 });
    }

    const [leadsBM1_Pag1, leadsBM1_Pag2, leadsBM2, leadsBM3] = await Promise.all([
      fetchSheetData(sheets, id1, 'sheet1', 'Página1'),
      fetchSheetData(sheets, id1, 'sheet1', 'Página2'),
      fetchSheetData(sheets, id2, 'sheet2', 'Página1'),
      fetchSheetData(sheets, id3, 'sheet3', 'Página1')
    ]);

    const todosLeads = [...leadsBM1_Pag1, ...leadsBM1_Pag2, ...leadsBM2, ...leadsBM3];
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
    console.error("Erro na rota GET:", error);
    return NextResponse.json({ error: 'Erro ao acessar dados.' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { action, leadData, id, novaSituacao, observacoes } = body;

    const auth = new google.auth.GoogleAuth({
      credentials: {
        client_email: process.env.GOOGLE_CLIENT_EMAIL,
        private_key: process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
      },
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });

    const sheets = google.sheets({ version: 'v4', auth });

    // ==========================================
    // CRIAÇÃO DE NOVO LEAD MANUAL
    // ==========================================
    if (action === 'create') {
      const spreadsheetId = process.env.GOOGLE_SHEET_ID_1; 
      if (!spreadsheetId) return NextResponse.json({ error: 'ID da Planilha 1 não configurado' }, { status: 500 });
      
      const rangeName = 'Página1'; 

      const headerResponse = await sheets.spreadsheets.values.get({ spreadsheetId, range: `${rangeName}!1:1` });
      const headers: string[] = headerResponse.data.values?.[0] || [];
      const originalHeaderLength = headers.length;
      
      const normalizedHeaders = headers.map((h: any) => h ? h.toString().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim() : '');
      
      const newRow: any[] = new Array(headers.length).fill('');
      
      const setCol = (nameAliases: string[], value: string) => {
        let idx = -1;
        for(const alias of nameAliases) {
          idx = normalizedHeaders.indexOf(alias);
          if(idx !== -1) break;
        }
        if(idx !== -1) {
            newRow[idx] = value;
        } else {
            headers.push(nameAliases[0]);
            normalizedHeaders.push(nameAliases[0].toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim());
            newRow.push(value);
        }
      };

      setCol(['nome', 'full_name', 'full name'], leadData?.nome || '');
      setCol(['email'], leadData?.email || '');
      setCol(['cargo', 'qual_a_sua_especialidade_medica?', 'qual_a_sua_especialidade?'], leadData?.cargo || '');
      setCol(['whatsapp', 'telefone', 'qual_seu_numero_de_whatsapp?'], leadData?.whatsapp || '');
      setCol(['created_time', 'created time', 'data de criacao'], leadData?.created_time || '');
      setCol(['data_alteracao'], leadData?.data_alteracao || '');
      setCol(['situacao', 'lead_status'], leadData?.situacao || 'Novos Leads');
      setCol(['origem'], leadData?.origem || 'Manual');

      // Atualiza o cabeçalho se criamos novas colunas (ex: origem)
      if (headers.length > originalHeaderLength) {
        await sheets.spreadsheets.values.update({
          spreadsheetId, 
          range: `${rangeName}!1:1`,
          valueInputOption: 'USER_ENTERED',
          requestBody: { values: [headers] }
        });
      }

      await sheets.spreadsheets.values.append({
        spreadsheetId,
        range: rangeName,
        valueInputOption: 'USER_ENTERED',
        insertDataOption: 'INSERT_ROWS',
        requestBody: { values: [newRow] }
      });

      return NextResponse.json({ success: true });
    }

    // ==========================================
    // ATUALIZAÇÃO (STATUS OU OBSERVAÇÃO)
    // ==========================================
    if (!id) return NextResponse.json({ error: 'Faltam dados de ID para atualização' }, { status: 400 });

    const parts = id.split('-lead-');
    if (parts.length !== 2) throw new Error('ID inválido');
    
    const aliasERange = parts[0].split('_'); 
    const sheetAlias = aliasERange[0]; 
    const rangeName = aliasERange[1] || 'Página1'; 
    const rowIndex = parseInt(parts[1], 10);
    const sheetRow = rowIndex + 2; 

    let spreadsheetId = '';
    if (sheetAlias === 'sheet1') spreadsheetId = process.env.GOOGLE_SHEET_ID_1 || '';
    else if (sheetAlias === 'sheet2') spreadsheetId = process.env.GOOGLE_SHEET_ID_2 || '';
    else if (sheetAlias === 'sheet3') spreadsheetId = process.env.GOOGLE_SHEET_ID_3 || '';

    if (!spreadsheetId) return NextResponse.json({ error: 'Planilha não identificada' }, { status: 400 });

    const headerResponse = await sheets.spreadsheets.values.get({ spreadsheetId, range: `${rangeName}!1:1` });
    const headers = headerResponse.data.values?.[0] || [];
    const normalizedHeaders = headers.map((h: any) => h ? h.toString().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim() : '');
    
    const getColLetter = (index: number) => {
      let letter = '';
      let tempIndex = index;
      while (tempIndex >= 0) {
        letter = String.fromCharCode((tempIndex % 26) + 65) + letter;
        tempIndex = Math.floor(tempIndex / 26) - 1;
      }
      return letter;
    };

    const dataToUpdate: any[] = [];
    let nextAvailableCol = headers.length;

    if (novaSituacao !== undefined) {
      let statusIdx = normalizedHeaders.indexOf('lead_status');
      if (statusIdx === -1) statusIdx = normalizedHeaders.indexOf('situacao');
      if (statusIdx === -1) { 
          statusIdx = nextAvailableCol++; 
          dataToUpdate.push({ range: `${rangeName}!${getColLetter(statusIdx)}1`, values: [['lead_status']] }); 
      }

      let dateIdx = normalizedHeaders.indexOf('data_alteracao');
      if (dateIdx === -1) { 
          dateIdx = nextAvailableCol++; 
          dataToUpdate.push({ range: `${rangeName}!${getColLetter(dateIdx)}1`, values: [['data_alteracao']] }); 
      }

      dataToUpdate.push({ range: `${rangeName}!${getColLetter(statusIdx)}${sheetRow}`, values: [[novaSituacao]] });
      dataToUpdate.push({ range: `${rangeName}!${getColLetter(dateIdx)}${sheetRow}`, values: [[new Date().toLocaleString('pt-BR')]] });
    }

    if (observacoes !== undefined) {
      let obsIdx = normalizedHeaders.indexOf('observacoes');
      if (obsIdx === -1) obsIdx = normalizedHeaders.indexOf('observacao');
      if (obsIdx === -1) { 
          obsIdx = nextAvailableCol++; 
          dataToUpdate.push({ range: `${rangeName}!${getColLetter(obsIdx)}1`, values: [['observacoes']] }); 
      }

      dataToUpdate.push({ range: `${rangeName}!${getColLetter(obsIdx)}${sheetRow}`, values: [[observacoes]] });
    }

    if (dataToUpdate.length > 0) {
      await sheets.spreadsheets.values.batchUpdate({
        spreadsheetId,
        requestBody: { valueInputOption: 'USER_ENTERED', data: dataToUpdate },
      });
    }

    return NextResponse.json({ success: true });

  } catch (error) {
    console.error("Erro ao salvar no Sheets:", error);
    return NextResponse.json({ error: 'Erro interno ao salvar.' }, { status: 500 });
  }
}