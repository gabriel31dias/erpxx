/**
 * Matriz de permissões. ponytail: papéis fixos em código no lugar das tabelas
 * Role/Permission/UserRole — a criação de funções personalizadas está no roadmap
 * e cabe aqui virando uma tabela `Role` com a mesma lista de strings.
 */
export const ROLES = ['proprietario', 'admin', 'gerente', 'caixa', 'estoquista', 'financeiro'] as const;
export type Role = (typeof ROLES)[number];

export const PERMISSIONS = [
  'dashboard.visualizar',

  'produto.visualizar', 'produto.criar', 'produto.editar', 'produto.excluir', 'produto.importar',
  'categoria.gerenciar', 'tabela_preco.gerenciar',

  'estoque.visualizar', 'estoque.movimentar', 'estoque.entrada',

  'cliente.visualizar', 'cliente.gerenciar',
  'fornecedor.visualizar', 'fornecedor.gerenciar',

  'pdv.acessar', 'pdv.desconto', 'pdv.cancelar_item', 'pdv.cancelar_venda',
  'venda.visualizar',

  'caixa.visualizar', 'caixa.abrir', 'caixa.fechar', 'caixa.sangria', 'caixa.suprimento',

  'financeiro.visualizar', 'financeiro.gerenciar',

  'relatorio.visualizar', 'relatorio.exportar',

  'usuario.gerenciar', 'empresa.gerenciar', 'plano.gerenciar', 'auditoria.visualizar',
] as const;
export type Permission = (typeof PERMISSIONS)[number];

const CAIXA: Permission[] = [
  'dashboard.visualizar', 'produto.visualizar', 'estoque.visualizar',
  'cliente.visualizar', 'cliente.gerenciar',
  'pdv.acessar', 'pdv.cancelar_item', 'venda.visualizar',
  'caixa.visualizar', 'caixa.abrir', 'caixa.fechar',
];

const ESTOQUISTA: Permission[] = [
  'dashboard.visualizar', 'produto.visualizar', 'produto.criar', 'produto.editar', 'categoria.gerenciar',
  'estoque.visualizar', 'estoque.movimentar', 'estoque.entrada',
  'fornecedor.visualizar', 'fornecedor.gerenciar', 'relatorio.visualizar',
];

const FINANCEIRO: Permission[] = [
  'dashboard.visualizar', 'produto.visualizar', 'estoque.visualizar',
  'cliente.visualizar', 'fornecedor.visualizar', 'venda.visualizar',
  'caixa.visualizar', 'financeiro.visualizar', 'financeiro.gerenciar',
  'relatorio.visualizar', 'relatorio.exportar',
];

const GERENTE: Permission[] = PERMISSIONS.filter(
  (p) => !['usuario.gerenciar', 'plano.gerenciar', 'empresa.gerenciar'].includes(p),
);

export const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  proprietario: PERMISSIONS,
  admin: PERMISSIONS.filter((p) => p !== 'plano.gerenciar'),
  gerente: GERENTE,
  caixa: CAIXA,
  estoquista: ESTOQUISTA,
  financeiro: FINANCEIRO,
};

export const ROLE_LABELS: Record<Role, string> = {
  proprietario: 'Proprietário',
  admin: 'Administrador',
  gerente: 'Gerente',
  caixa: 'Caixa',
  estoquista: 'Estoquista',
  financeiro: 'Financeiro',
};

export function can(role: string, permission: Permission): boolean {
  const perms = ROLE_PERMISSIONS[role as Role];
  return !!perms && perms.includes(permission);
}

export function permissionsOf(role: string): readonly Permission[] {
  return ROLE_PERMISSIONS[role as Role] ?? [];
}
