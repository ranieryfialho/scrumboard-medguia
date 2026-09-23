import { google, sheets_v4 } from 'googleapis';
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createClient as createServerClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

async function getEmpresa(request?: NextRequest) {
  try {
    const supabase = await createServerClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user?.user_metadata?.empresa_id) return null;

    const admin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    // Super admin: usa empresa selecionada via cookie
    if (user.user_metadata?.is_super_admin && request) {
      const selectedId = request.cookies.get('selected_empresa_id')?.value;
      if (selectedId) {
        const { data } = await admin
          .from('empresas')
          .select('id, usa_sheets')
          .eq('id', selectedId)
          .single();
        if (data) return data as { id: string; usa_sheets: boolean };
      }
    }

    const { data } = await admin
      .from('empresas')
      .select('id, usa_sheets')
      .eq('id', user.user_metadata.empresa_id)
      .single();

    return data as { id: string; usa_sheets: boolean } | null;
  } catch {
    return null;
  }
}

async function getEmpresaConfig(empresaId: string): Promise<Record<string, string>> {
  try {
    const admin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );
    const { data } = await admin
      .from('empresa_configuracoes')
      .select('chave, valor')
      .eq('empresa_id', empresaId);

    return (data || []).reduce((acc: Record<string, string>, row) => {
      acc[row.chave] = row.valor;
      return acc;
    }, {});
  } catch {
    return {};
  }
}

const STATUS_MAP: Record<string, string> = {
  'created': 'Novos Leads',
  'new': 'Novos Leads',
  'novo': 'Novos Leads',
  'novos leads': 'Novos Leads',
  '': 'Novos Leads',
  'sem situacao': 'Novos Leads',
  'em contato': 'Em contato',
  'contacted': 'Em contato',
  'recontato': 'Recontato',
  'reuniao agendada': 'Reunião agendada',
  'meeting scheduled': 'Reunião agendada',
  'aguardando ativacao': 'Aguardando Ativação',
  'pending activation': 'Aguardando Ativação',
  'logins ativados': 'Logins Ativados',
  'fechamento de clientes': 'Fechamento de Clientes',
  'fechado': 'Logins Ativados',
  'closed': 'Logins Ativados',
  'won': 'Logins Ativados',
  'sem interesse': 'Sem interesse',
  'not interested': 'Sem interesse',
  'desqualificado': 'Desqualificado',
  'disqualified': 'Desqualificado',
  'arquivado': 'Arquivado',
  'archived': 'Arquivado',
};

const SHEET_KEY_ORIGEM_MAP: Record<string, string> = {
  'sheet1/Página1': 'BM MedGuia',
  'sheet1/Página2': 'BM Dr. Felipe',
  'sheet2/Página1': 'BM Dr. Felipe',
  'sheet3/Página1': 'BM MedGuia',
};

function normalizarStatus(rawStatus: string | undefined): string {
  if (!rawStatus || rawStatus.trim() === '') return 'Novos Leads';
  const key = rawStatus
    .toLowerCase()
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
  return STATUS_MAP[key] ?? 'Novos Leads';
}

function enriquecerOrigemManual(origemAtual: string, observacoes: string): string {
  if (origemAtual !== 'Manual') return origemAtual;
  if (!observacoes) return 'Manual';

  const obs = observacoes
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

  if (/\blp\b/.test(obs) || /landing\s*page/.test(obs)) return 'Manual - LP';
  if (/indica[çc][aã]o/.test(obs) || /\bindicado\b/.test(obs) || /\bindicada\b/.test(obs)) return 'Manual - Indicação';

  return 'Manual';
}

async function fetchSheetData(
  sheets: sheets_v4.Sheets,
  spreadsheetId: string,
  sheetAlias: string,
  rangeName: string
): Promise<Record<string, string>[]> {
  try {
    const response = await sheets.spreadsheets.values.get({ spreadsheetId, range: rangeName });
    const rows = response.data.values;

    if (!rows || rows.length === 0) return [];

    const headers: string[] = rows[0].map((header) =>
      header
        ? header.toString().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim()
        : ''
    );

    const sheetKey = `${sheetAlias}/${rangeName}`;
    const origemDaPlanilha = SHEET_KEY_ORIGEM_MAP[sheetKey] || '';

    return rows.slice(1).map((row, index: number) => {
      const leadData: Record<string, string> = { id: `${sheetAlias}_${rangeName}-lead-${index}` };

      headers.forEach((header: string, colIndex: number) => {
        const valor = row[colIndex] ?? '';
        if (header === 'id') leadData['meta_id'] = valor;
        else if (header) leadData[header] = valor;
      });

      if (sheetKey === 'sheet1/Página1') {
        leadData.nome = leadData['company_name'] || leadData['cargo'] || leadData['nome'] || 'Sem Nome';
        leadData.cargo = leadData['full_name'] || leadData['cargo'] || '';

      } else if (sheetKey === 'sheet1/Página2' || sheetKey === 'sheet2/Página1') {
        leadData.nome = leadData['first name'] || leadData['first_name'] || 'Sem Nome';
        leadData.cargo = leadData['qual_a_sua_especialidade?'] || leadData['qual_a_sua_especialidade'] || '';

      } else if (sheetKey === 'sheet3/Página1') {
        leadData.nome = leadData['full name'] || leadData['full_name'] || 'Sem Nome';
        leadData.cargo = leadData['qual_a_sua_especialidade_medica?'] || leadData['qual_a_sua_especialidade_medica'] || '';

      } else {
        leadData.nome =
          leadData['full_name'] ||
          leadData['full name'] ||
          leadData['first_name'] ||
          leadData['first name'] ||
          leadData['company_name'] ||
          leadData['nome'] ||
          'Sem Nome';

        leadData.cargo =
          leadData['qual_a_sua_especialidade_medica?'] ||
          leadData['qual_a_sua_especialidade_medica'] ||
          leadData['qual_a_sua_especialidade?'] ||
          leadData['qual_a_sua_especialidade'] ||
          leadData['company_name'] ||
          leadData['cargo'] ||
          '';
      }

      leadData.whatsapp =
        leadData['phone_number'] ||
        leadData['telefone'] ||
        leadData['qual_seu_numero_de_whatsapp?'] ||
        leadData['qual_seu_numero_de_whatsapp'] ||
        leadData['qual_seu_numero'] ||
        leadData['whatsapp'] ||
        '';

      leadData.email = leadData['email'] || '';

      leadData.anuncio =
        leadData['ad_name'] ||
        leadData['nome_do_anuncio'] ||
        leadData['campaign_name'] ||
        leadData['utm_campaign'] ||
        'Desconhecido';

      leadData.created_time =
        leadData['created_time'] ||
        leadData['created time'] ||
        leadData['data de criacao'] ||
        leadData['data_de_criacao'] ||
        '';

      leadData.data_fechamento =
        leadData['data_fechamento'] ||
        leadData['data de fechamento'] ||
        '';

      leadData.data_alteracao =
        leadData['data_alteracao'] ||
        leadData['data de alteracao'] ||
        '';

      leadData.observacoes = leadData['observacoes'] || leadData['observacao'] || '';

      const origemExistente = leadData['origem'] || '';

      if (origemExistente.startsWith('Manual')) {
        leadData.origem = enriquecerOrigemManual(origemExistente, leadData.observacoes);
      } else {
        leadData.origem = origemDaPlanilha || origemExistente || '';
      }

      const crmRaw =
        leadData['qual_o_numero_do_seu_crm?'] ||
        leadData['qual_o_numero_do_seu_crm'];
      if (crmRaw) {
        leadData.tipo = `CRM: ${crmRaw}`;
      }

      const rawStatus = leadData['lead_status'] || leadData['situacao'] || '';
      leadData.situacao = normalizarStatus(rawStatus);

      return leadData;
    });
  } catch (error) {
    console.error(`Erro ao buscar dados da planilha ${sheetAlias} aba ${rangeName}:`, error);
    return [];
  }
}

export async function GET(request: NextRequest) {
  const empresa = await getEmpresa(request);

  // Tenant sem Google Sheets: lê da tabela leads do Supabase
  if (empresa && !empresa.usa_sheets) {
    const admin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );
    const { data: leads, error } = await admin
      .from('leads')
      .select('*')
      .eq('empresa_id', empresa.id)
      .order('criado_em', { ascending: false });

    if (error) {
      console.error('Erro ao buscar leads do Supabase:', error);
      return NextResponse.json({ error: 'Erro ao buscar leads.' }, { status: 500 });
    }

    const leadsFormatados = (leads || []).map((lead) => ({
      id: `sb-${lead.id}`,
      nome: lead.nome || 'Sem Nome',
      email: lead.email || '',
      whatsapp: lead.whatsapp || '',
      cargo: lead.cargo || '',
      tipo: lead.tipo || '',
      situacao: lead.situacao || 'Novos Leads',
      origem: lead.origem || 'Manual',
      observacoes: lead.observacoes || '',
      anuncio: lead.anuncio || 'Desconhecido',
      responsavel: lead.responsavel || '',
      created_time: lead.criado_em || '',
      data_alteracao: lead.data_alteracao || '',
      data_fechamento: lead.data_fechamento || '',
    }));

    return NextResponse.json(leadsFormatados);
  }

  // Tenant com Google Sheets: lê credenciais do banco (fallback para env vars)
  try {
    const dbConfig = empresa ? await getEmpresaConfig(empresa.id) : {};

    const auth = new google.auth.GoogleAuth({
      credentials: {
        client_email: dbConfig.google_client_email || process.env.GOOGLE_CLIENT_EMAIL,
        private_key: (dbConfig.google_private_key || process.env.GOOGLE_PRIVATE_KEY)?.replace(/\\n/g, '\n'),
      },
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });

    const sheets = google.sheets({ version: 'v4', auth });
    const id1 = dbConfig.google_sheet_id_1 || process.env.GOOGLE_SHEET_ID_1;
    const id2 = dbConfig.google_sheet_id_2 || process.env.GOOGLE_SHEET_ID_2;
    const id3 = dbConfig.google_sheet_id_3 || process.env.GOOGLE_SHEET_ID_3;

    if (!id1 || !id2 || !id3) {
      return NextResponse.json(
        { error: 'Faltam IDs das planilhas nas configurações' },
        { status: 500 }
      );
    }

    const [leadsBM1_Pag1, leadsBM1_Pag2, leadsBM2, leadsBM3] = await Promise.all([
      fetchSheetData(sheets, id1, 'sheet1', 'Página1'),
      fetchSheetData(sheets, id1, 'sheet1', 'Página2'),
      fetchSheetData(sheets, id2, 'sheet2', 'Página1'),
      fetchSheetData(sheets, id3, 'sheet3', 'Página1'),
    ]);

    // =============================================
    // BUSCA OS LEADS DO BANCO DE DADOS DA LP - AULA
    // =============================================
    let leadsDaLP: Record<string, string>[] = [];
    const supabaseLpUrl = process.env.SUPABASE_LP_URL;
    const supabaseLpKey = process.env.SUPABASE_LP_ANON_KEY;

    if (supabaseLpUrl && supabaseLpKey) {
      const supabaseLp = createClient(supabaseLpUrl, supabaseLpKey);
      const { data: supabaseLeads, error } = await supabaseLp.from('leads').select('*');
      
      if (!error && supabaseLeads) {
        leadsDaLP = supabaseLeads.map(lead => ({
          id: `lp-${lead.id}`, 
          nome: lead.name || 'Sem Nome',
          email: lead.email || '',
          whatsapp: lead.whatsapp || '',
          cargo: lead.especialidade || '',
          tipo: lead.crm ? `CRM: ${lead.crm}` : '',
          origem: 'LP - Aula', 
          situacao: normalizarStatus(lead.status) || 'Novos Leads',
          created_time: lead.created_at || new Date().toISOString(),
          data_alteracao: lead.data_alteracao || '',
          data_fechamento: lead.data_fechamento || '',
          observacoes: lead.observacoes || '',
          anuncio: lead.anuncio || 'Desconhecido'
        }));
      } else if (error) {
        console.error("Erro ao buscar leads da LP:", error);
      }
    }

    const todosLeads = [...leadsBM1_Pag1, ...leadsBM1_Pag2, ...leadsBM2, ...leadsBM3, ...leadsDaLP];
    const leadsUnicos: Record<string, string>[] = [];
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

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { action, leadData, id, novaSituacao, observacoes, dadosFechamento } = body;

    // =====================================================
    // LEADS DO SUPABASE (tenants sem Google Sheets): sb-
    // =====================================================
    if (id && id.startsWith('sb-')) {
      const admin = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!
      );
      const realId = id.replace('sb-', '');
      const dataAtualISO = new Date().toISOString();
      const updateData: Record<string, unknown> = {};

      if (novaSituacao !== undefined) {
        updateData.situacao = novaSituacao;
        updateData.data_alteracao = dataAtualISO;
        if (['Logins Ativados', 'Fechamento de Clientes', 'Aguardando Ativação'].includes(novaSituacao)) {
          updateData.data_fechamento = dataAtualISO;
        }
      }
      if (observacoes !== undefined) updateData.observacoes = observacoes;
      if (dadosFechamento) updateData.dados_fechamento = dadosFechamento;

      const { error } = await admin.from('leads').update(updateData).eq('id', realId);
      if (error) {
        console.error('Erro ao atualizar lead no Supabase:', error);
        return NextResponse.json({ error: 'Erro ao atualizar lead.' }, { status: 500 });
      }
      return NextResponse.json({ success: true });
    }

    // =====================================================
    // CRIAÇÃO DE LEAD MANUAL para tenant sem Google Sheets
    // =====================================================
    if (action === 'create') {
      const empresa = await getEmpresa(request);
      if (empresa && !empresa.usa_sheets) {
        const admin = createClient(
          process.env.NEXT_PUBLIC_SUPABASE_URL!,
          process.env.SUPABASE_SERVICE_ROLE_KEY!
        );
        const { data: novoLead, error } = await admin
          .from('leads')
          .insert({
            empresa_id: empresa.id,
            nome: leadData?.nome || '',
            email: leadData?.email || '',
            whatsapp: leadData?.whatsapp || '',
            cargo: leadData?.cargo || '',
            situacao: leadData?.situacao || 'Novos Leads',
            origem: leadData?.origem || 'Manual',
            anuncio: leadData?.anuncio || '',
            criado_em: leadData?.created_time
              ? new Date(leadData.created_time).toISOString()
              : new Date().toISOString(),
            data_alteracao: new Date().toISOString(),
          })
          .select()
          .single();

        if (error) {
          console.error('Erro ao criar lead no Supabase:', error);
          return NextResponse.json({ error: 'Erro ao criar lead.' }, { status: 500 });
        }
        return NextResponse.json({ success: true, id: `sb-${novoLead.id}` });
      }
      // MedGuia ou tenant com Sheets: segue para o fluxo original abaixo
    }

    // =================================================
    // INTERCEPTA ATUALIZAÇÕES PARA O BANCO DA LP - AULA
    // =================================================
    if (id && id.startsWith('lp-')) {
      const supabaseLpUrl = process.env.SUPABASE_LP_URL;
      const supabaseLpKey = process.env.SUPABASE_LP_ANON_KEY;
      
      if (!supabaseLpUrl || !supabaseLpKey) {
        return NextResponse.json({ error: 'Credenciais da LP não configuradas' }, { status: 500 });
      }

      const supabaseLp = createClient(supabaseLpUrl, supabaseLpKey);
      const realId = id.replace('lp-', '');
      const dataAtualISO = new Date().toISOString(); 

      const updateData: Record<string, unknown> = {};

      if (novaSituacao !== undefined) {
        updateData.status = novaSituacao;
        updateData.data_alteracao = dataAtualISO; 
        
        if (['Logins Ativados', 'Fechamento de Clientes', 'Aguardando Ativação'].includes(novaSituacao)) {
           updateData.data_fechamento = dataAtualISO;
        }
      } 
      
      if (observacoes !== undefined) {
        updateData.observacoes = observacoes;
      }

      if (dadosFechamento) {
        updateData.dados_fechamento = dadosFechamento; 
      }

      const { error } = await supabaseLp.from('leads').update(updateData).eq('id', realId);
      
      if (error) {
        console.error("Erro ao atualizar lead na LP:", error);
        return NextResponse.json({ error: 'Erro ao atualizar banco da LP' }, { status: 500 });
      }

      return NextResponse.json({ success: true });
    }

    // ==========================================
    // FLUXO ORIGINAL PARA O GOOGLE SHEETS
    // ==========================================
    const auth = new google.auth.GoogleAuth({
      credentials: {
        client_email: process.env.GOOGLE_CLIENT_EMAIL,
        private_key: process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
      },
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });

    const sheets = google.sheets({ version: 'v4', auth });

    if (action === 'create') {
      const spreadsheetId = process.env.GOOGLE_SHEET_ID_1;
      if (!spreadsheetId)
        return NextResponse.json({ error: 'ID da Planilha 1 não configurado' }, { status: 500 });

      const rangeName = 'Página1';

      const headerResponse = await sheets.spreadsheets.values.get({
        spreadsheetId,
        range: `${rangeName}!1:1`,
      });
      const headers: string[] = headerResponse.data.values?.[0] || [];
      const originalHeaderLength = headers.length;

      const normalizedHeaders = headers.map((h) =>
        h ? h.toString().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim() : ''
      );

      const newRow: string[] = new Array(headers.length).fill('');

      const setCol = (nameAliases: string[], value: string) => {
        let idx = -1;
        for (const alias of nameAliases) {
          idx = normalizedHeaders.indexOf(alias);
          if (idx !== -1) break;
        }
        if (idx !== -1) {
          newRow[idx] = value;
        } else {
          headers.push(nameAliases[0]);
          normalizedHeaders.push(
            nameAliases[0].toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim()
          );
          newRow.push(value);
        }
      };

      setCol(['full_name', 'full name', 'first_name', 'first name', 'nome'], leadData?.nome || '');
      setCol(['email'], leadData?.email || '');
      setCol(['company_name', 'qual_a_sua_especialidade_medica', 'qual_a_sua_especialidade_medica?', 'cargo'], leadData?.cargo || '');
      setCol(['phone_number', 'telefone', 'qual_seu_numero_de_whatsapp', 'qual_seu_numero_de_whatsapp?', 'whatsapp'], leadData?.whatsapp || '');
      setCol(['created_time', 'created time', 'data de criacao'], leadData?.created_time || '');
      setCol(['data_alteracao'], leadData?.data_alteracao || '');
      setCol(['data_fechamento', 'data de fechamento'], leadData?.data_fechamento || '');
      setCol(['lead_status', 'situacao'], leadData?.situacao || 'Novos Leads');
      setCol(['origem'], leadData?.origem || 'Manual');
      setCol(['ad_name', 'anuncio', 'nome_do_anuncio'], leadData?.anuncio || '');

      if (headers.length > originalHeaderLength) {
        await sheets.spreadsheets.values.update({
          spreadsheetId,
          range: `${rangeName}!1:1`,
          valueInputOption: 'USER_ENTERED',
          requestBody: { values: [headers] },
        });
      }

      await sheets.spreadsheets.values.append({
        spreadsheetId,
        range: rangeName,
        valueInputOption: 'USER_ENTERED',
        insertDataOption: 'INSERT_ROWS',
        requestBody: { values: [newRow] },
      });

      return NextResponse.json({ success: true });
    }

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

    if (!spreadsheetId)
      return NextResponse.json({ error: 'Planilha não identificada' }, { status: 400 });

    const headerResponse = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `${rangeName}!1:1`,
    });
    const headers = headerResponse.data.values?.[0] || [];
    const normalizedHeaders = headers.map((h) =>
      h ? h.toString().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim() : ''
    );

    const getColLetter = (index: number) => {
      let letter = '';
      let tempIndex = index;
      while (tempIndex >= 0) {
        letter = String.fromCharCode((tempIndex % 26) + 65) + letter;
        tempIndex = Math.floor(tempIndex / 26) - 1;
      }
      return letter;
    };

    const dataToUpdate: { range: string; values: string[][] }[] = [];
    let nextAvailableCol = headers.length;

    if (novaSituacao !== undefined) {
      let statusIdx = normalizedHeaders.indexOf('lead_status');
      if (statusIdx === -1) statusIdx = normalizedHeaders.indexOf('situacao');
      if (statusIdx === -1) {
        statusIdx = nextAvailableCol++;
        dataToUpdate.push({
          range: `${rangeName}!${getColLetter(statusIdx)}1`,
          values: [['lead_status']],
        });
      }

      let dateIdx = normalizedHeaders.indexOf('data_alteracao');
      if (dateIdx === -1) {
        dateIdx = nextAvailableCol++;
        dataToUpdate.push({
          range: `${rangeName}!${getColLetter(dateIdx)}1`,
          values: [['data_alteracao']],
        });
      }

      const dataAtualStr = new Date().toLocaleString('pt-BR');

      dataToUpdate.push({
        range: `${rangeName}!${getColLetter(statusIdx)}${sheetRow}`,
        values: [[novaSituacao]],
      });
      dataToUpdate.push({
        range: `${rangeName}!${getColLetter(dateIdx)}${sheetRow}`,
        values: [[dataAtualStr]],
      });

      const STATUS_CONVERSAO = ['Logins Ativados', 'Fechamento de Clientes', 'Aguardando Ativação'];
      if (STATUS_CONVERSAO.includes(novaSituacao)) {
        let fechamentoIdx = normalizedHeaders.indexOf('data_fechamento');
        if (fechamentoIdx === -1) fechamentoIdx = normalizedHeaders.indexOf('data de fechamento');
        if (fechamentoIdx === -1) {
          fechamentoIdx = nextAvailableCol++;
          dataToUpdate.push({
            range: `${rangeName}!${getColLetter(fechamentoIdx)}1`,
            values: [['data_fechamento']],
          });
        }
        dataToUpdate.push({
          range: `${rangeName}!${getColLetter(fechamentoIdx)}${sheetRow}`,
          values: [[dataAtualStr]],
        });
      }
    }

    if (observacoes !== undefined) {
      let obsIdx = normalizedHeaders.indexOf('observacoes');
      if (obsIdx === -1) obsIdx = normalizedHeaders.indexOf('observacao');
      if (obsIdx === -1) {
        obsIdx = nextAvailableCol++;
        dataToUpdate.push({
          range: `${rangeName}!${getColLetter(obsIdx)}1`,
          values: [['observacoes']],
        });
      }

      dataToUpdate.push({
        range: `${rangeName}!${getColLetter(obsIdx)}${sheetRow}`,
        values: [[observacoes]],
      });

      const origemAtualIdx = normalizedHeaders.indexOf('origem');
      if (origemAtualIdx !== -1) {
        const rowResponse = await sheets.spreadsheets.values.get({
          spreadsheetId,
          range: `${rangeName}!${getColLetter(origemAtualIdx)}${sheetRow}`,
        });
        const origemNaPlanilha: string = rowResponse.data.values?.[0]?.[0] || '';

        if (origemNaPlanilha.startsWith('Manual')) {
          const novaOrigem = enriquecerOrigemManual(origemNaPlanilha, observacoes);
          if (novaOrigem !== origemNaPlanilha) {
            dataToUpdate.push({
              range: `${rangeName}!${getColLetter(origemAtualIdx)}${sheetRow}`,
              values: [[novaOrigem]],
            });
          }
        }
      }
    }

    if (dadosFechamento) {
      for (const [key, value] of Object.entries(dadosFechamento)) {
        if (!value) continue;

        let colIdx = normalizedHeaders.indexOf(key);
        if (colIdx === -1) {
          colIdx = nextAvailableCol++;
          dataToUpdate.push({
            range: `${rangeName}!${getColLetter(colIdx)}1`,
            values: [[key]],
          });
          normalizedHeaders.push(key);
        }

        dataToUpdate.push({
          range: `${rangeName}!${getColLetter(colIdx)}${sheetRow}`,
          values: [[String(value)]],
        });
      }
    }

    if (dataToUpdate.length > 0) {
      const colunasNovas = nextAvailableCol - headers.length;
      if (colunasNovas > 0) {
        const metadataRes = await sheets.spreadsheets.get({ spreadsheetId });
        const sheetMeta = metadataRes.data.sheets?.find(
          (s) => s.properties?.title === rangeName
        );
        if (sheetMeta?.properties?.sheetId !== undefined) {
          await sheets.spreadsheets.batchUpdate({
            spreadsheetId,
            requestBody: {
              requests: [{ appendDimension: { sheetId: sheetMeta.properties.sheetId, dimension: 'COLUMNS', length: colunasNovas } }],
            },
          });
        }
      }

      await sheets.spreadsheets.values.batchUpdate({
        spreadsheetId,
        requestBody: { valueInputOption: 'USER_ENTERED', data: dataToUpdate },
      });
    }

    return NextResponse.json({ success: true });

  } catch (error) {
    console.error("Erro ao salvar no Sheets/Supabase:", error);
    return NextResponse.json({ error: 'Erro interno ao salvar.' }, { status: 500 });
  }
}