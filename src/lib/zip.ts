// T-293 (fase4-card-abas, US-112, AC-750): gerador mínimo de arquivo ZIP, sem dependência: método "armazenado" (sem compressão — os
// anexos já são imagem e PDF, que não encolhem), nomes em UTF-8 e data de cada arquivo. Sem ZIP64: serve para até 65 535 arquivos e
// 4 GB no total, bem acima do que um dossiê de card tem.

export interface ArquivoDoZip {
  /** Caminho dentro do ZIP, com `/` como separador. */
  nome: string;
  bytes: Uint8Array;
  data: Date;
}

const TABELA_CRC = (() => {
  const tabela = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    tabela[n] = c >>> 0;
  }
  return tabela;
})();

export function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = TABELA_CRC[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** Hora e dia no formato MS-DOS que o ZIP usa (anos antes de 1980 viram 1980). */
function dataDos(data: Date): { hora: number; dia: number } {
  const ano = Math.max(1980, data.getFullYear());
  return {
    hora: (data.getHours() << 11) | (data.getMinutes() << 5) | (data.getSeconds() >> 1),
    dia: ((ano - 1980) << 9) | ((data.getMonth() + 1) << 5) | data.getDate(),
  };
}

export function criarZip(arquivos: ArquivoDoZip[]): Buffer {
  const partes: Buffer[] = [];
  const central: Buffer[] = [];
  let deslocamento = 0;

  for (const arquivo of arquivos) {
    const nome = Buffer.from(arquivo.nome, 'utf8');
    const dados = Buffer.from(arquivo.bytes);
    const crc = crc32(arquivo.bytes);
    const { hora, dia } = dataDos(arquivo.data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // versão necessária
    local.writeUInt16LE(0x0800, 6); // bit 11: nome em UTF-8
    local.writeUInt16LE(0, 8); // armazenado
    local.writeUInt16LE(hora, 10);
    local.writeUInt16LE(dia, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(dados.length, 18);
    local.writeUInt32LE(dados.length, 22);
    local.writeUInt16LE(nome.length, 26);
    local.writeUInt16LE(0, 28);
    partes.push(local, nome, dados);

    const entrada = Buffer.alloc(46);
    entrada.writeUInt32LE(0x02014b50, 0);
    entrada.writeUInt16LE(20, 4); // versão que criou
    entrada.writeUInt16LE(20, 6); // versão necessária
    entrada.writeUInt16LE(0x0800, 8);
    entrada.writeUInt16LE(0, 10);
    entrada.writeUInt16LE(hora, 12);
    entrada.writeUInt16LE(dia, 14);
    entrada.writeUInt32LE(crc, 16);
    entrada.writeUInt32LE(dados.length, 20);
    entrada.writeUInt32LE(dados.length, 24);
    entrada.writeUInt16LE(nome.length, 28);
    entrada.writeUInt32LE(deslocamento, 42);
    central.push(entrada, nome);

    deslocamento += local.length + nome.length + dados.length;
  }

  const diretorio = Buffer.concat(central);
  const fim = Buffer.alloc(22);
  fim.writeUInt32LE(0x06054b50, 0);
  fim.writeUInt16LE(arquivos.length, 8);
  fim.writeUInt16LE(arquivos.length, 10);
  fim.writeUInt32LE(diretorio.length, 12);
  fim.writeUInt32LE(deslocamento, 16);
  return Buffer.concat([...partes, diretorio, fim]);
}
