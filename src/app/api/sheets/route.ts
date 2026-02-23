import { NextResponse } from 'next/server';
import { getGoogleSheetsClient } from '@/lib/google-sheets';
import { Lead } from '@/types/lead';

export async function GET() {
  try {
    const sheets = getGoogleSheetsClient();
    const spreadsheetId = process.env.GOOGLE_SHEET_ID;

    const response = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: 'Página1', // Verifique se o nome na aba da planilha é EXATAMENTE esse
    });

    const rows = response.data.values;

    if (!rows || rows.length === 0) {
      return NextResponse.json([]);
    }

    // Mapeia os cabeçalhos
    const headers = rows[0].map((header: any) => header.toString().toLowerCase().trim());

    // Mapeia os dados
    const leads: Lead[] = rows.slice(1).map((row, index) => {
      const leadData: any = {
        id: `lead-${index}`,
      };

      headers.forEach((header, colIndex) => {
        leadData[header] = row[colIndex] || '';
      });

      if (!leadData.situacao) {
        leadData.situacao = leadData['situação'] || 'Sem situação';
      }

      return leadData as Lead;
    });

    return NextResponse.json(leads);

  } catch (error: any) {
    console.error('ERRO NA API SHEETS:', error.response?.data || error.message);
    
    return NextResponse.json({ 
      error: 'Falha ao buscar leads', 
      details: error.response?.data?.error?.message || error.message 
    }, { status: 500 });
  }
}