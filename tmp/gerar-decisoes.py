#!/usr/bin/env python3
"""Preenche a coluna `etapa` de todos os itens da fila de revisão do ETL com a mesma etapa.
Uso: python3 gerar-decisoes.py <fila.csv> <decisoes.csv> "Entrada de leads"
Só imprime contagens (a planilha tem dado pessoal e fica em /root/etl-saida)."""
import csv
import sys

fila, saida, etapa = sys.argv[1], sys.argv[2], sys.argv[3]
with open(fila, encoding='utf-8-sig', newline='') as f:
    leitor = csv.DictReader(f, delimiter=';')
    colunas = leitor.fieldnames or []
    linhas = list(leitor)
if 'etapa' not in colunas or 'id_origem' not in colunas:
    sys.exit('FALHOU: a planilha não tem as colunas id_origem e etapa')
sem_id = sum(1 for l in linhas if not (l['id_origem'] or '').strip())
for l in linhas:
    l['etapa'] = etapa
with open(saida, 'w', encoding='utf-8-sig', newline='') as f:
    w = csv.DictWriter(f, fieldnames=colunas, delimiter=';')
    w.writeheader()
    w.writerows(linhas)
print(f'itens na fila: {len(linhas)} | sem id: {sem_id} | etapa aplicada: {etapa} | gravado em {saida}')
