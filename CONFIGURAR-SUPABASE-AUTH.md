# Configuração do Supabase Auth — AVANTROX

1. Em Supabase > Authentication > Providers > Email, habilite cadastro por e-mail e **Confirm email**.
2. Em Authentication > URL Configuration, configure o Site URL e URLs de redirecionamento para o endereço real do site. O link de confirmação do Supabase usa essa configuração.
3. Configure as variáveis de ambiente no processo Node.js (não cole credenciais secretas em HTML):

```powershell
$env:SUPABASE_URL="https://SEU-PROJETO.supabase.co"
$env:SUPABASE_PUBLISHABLE_KEY="sb_publishable_SUA_CHAVE"
$env:SESSION_SECRET="COLOQUE_UM_SEGREDO_ALEATORIO_LONGO"
npm install
npm start
```

4. Acesse cadastro.html, cadastre e-mail e senha, abra a mensagem de confirmação e clique no link. Volte para login.html e entre com **e-mail** e senha.

**Atenção:** o projeto enviado tinha autenticação própria em SQLite. A integração usa Supabase Auth para credenciais, mas mantém perfil e loja no SQLite local, vinculado ao ID Supabase. Contas antigas não são migradas automaticamente. Não publique sem configurar HTTPS, armazenamento persistente de sessões, e revisar as demais rotas de alteração de conta (e-mail, senha, recuperação) que ainda usam a lógica antiga. O envio padrão de e-mail do Supabase tem limites e não substitui SMTP de produção.

Não use `service_role` ou `sb_secret_` no navegador. O projeto não implementa pagamentos reais.
