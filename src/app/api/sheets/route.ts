import { NextResponse } from 'next/server';
import { getGoogleSheetsClient } from '@/lib/google-sheets';
import { Lead } from '@/types/lead';

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
      leadData[header] = row[colIndex] || '';
    });

    // ==================
    // MAPEAMENTO EXATO
    // ==================
    
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

export async function GET() {
  try {
    const sheets = getGoogleSheetsClient();
    const spreadsheetId = process.env.GOOGLE_SHEET_ID as string;

    const [leadsPagina1, leadsPagina2] = await Promise.all([
      fetchSheetData(sheets, spreadsheetId, 'Página1'),
      fetchSheetData(sheets, spreadsheetId, 'Página2')
    ]);

    const todosOsLeads = [...leadsPagina1, ...leadsPagina2];

    return NextResponse.json(todosOsLeads);

  } catch (error: any) {
    console.error('ERRO NA API SHEETS:', error.message);
    return NextResponse.json({ error: 'Falha ao buscar leads' }, { status: 500 });
  }
}