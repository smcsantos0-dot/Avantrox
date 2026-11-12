
"use strict";

// ==========================================
// AVANTROX - SERVIDOR PRINCIPAL
// ==========================================

const express = require("express");
const session = require("express-session");
const bcrypt = require("bcryptjs");
const Database = require("better-sqlite3");
const { rateLimit } = require("express-rate-limit");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const { CLASSES, SKILL_INDEX, skillStatus } = require("./classes-skills");

const app = express();
const PORT = Number(process.env.PORT) || 3000;

app.disable("x-powered-by");
app.use(express.json({ limit: "10kb" }));

// ==========================================
// BANCO DE DADOS
// ==========================================

const dataDirectory = path.join(
    __dirname,
    "..",
    "avantrox-data"
);

fs.mkdirSync(dataDirectory, { recursive: true });

const db = new Database(
    path.join(dataDirectory, "avantrox.sqlite")
);

db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
    CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT NOT NULL COLLATE NOCASE UNIQUE,
        email TEXT NOT NULL COLLATE NOCASE UNIQUE,
        password TEXT NOT NULL,
        player_class TEXT NOT NULL DEFAULT 'Guerreiro',
        level INTEGER NOT NULL DEFAULT 1,
        xp INTEGER NOT NULL DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
`);

const userColumns = new Set(
    db.prepare("PRAGMA table_info(users)")
        .all()
        .map(column => column.name)
);

if (!userColumns.has("player_class")) {
    db.exec(`
        ALTER TABLE users
        ADD COLUMN player_class TEXT
        NOT NULL DEFAULT 'Guerreiro'
    `);
}

if (!userColumns.has("level")) {
    db.exec(`
        ALTER TABLE users
        ADD COLUMN level INTEGER
        NOT NULL DEFAULT 1
    `);
}

if (!userColumns.has("xp")) {
    db.exec(`
        ALTER TABLE users
        ADD COLUMN xp INTEGER
        NOT NULL DEFAULT 0
    `);
}

if (!userColumns.has("supabase_id")) {
    db.exec("ALTER TABLE users ADD COLUMN supabase_id TEXT");
}
db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_users_supabase_id ON users(supabase_id)");

// ==========================================
// TABELA DE MISSÕES
// ==========================================

db.exec(`
    CREATE TABLE IF NOT EXISTS completed_missions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        mission_id TEXT NOT NULL,
        completed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_id, mission_id),
        FOREIGN KEY(user_id)
            REFERENCES users(id)
            ON DELETE CASCADE
    );
`);

// ==========================================
// ALTERAÇÃO DE E-MAIL
// ==========================================

db.exec(`
    CREATE TABLE IF NOT EXISTS pending_email_changes (
        user_id INTEGER PRIMARY KEY,
        new_email TEXT NOT NULL COLLATE NOCASE,
        code_hash TEXT NOT NULL,
        expires_at INTEGER NOT NULL,
        attempts INTEGER NOT NULL DEFAULT 0,
        FOREIGN KEY(user_id)
            REFERENCES users(id)
            ON DELETE CASCADE
    );
`);

// ==========================================
// LOJA: ASTRAS E INVENTÁRIO POR CONTA
// ==========================================
// Novas carteiras começam com zero Astras. Créditos exigem operação autorizada.
db.exec(`
    CREATE TABLE IF NOT EXISTS player_wallets (
        user_id INTEGER PRIMARY KEY,
        astras INTEGER NOT NULL DEFAULT 0 CHECK(astras >= 0),
        FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS player_items (
        user_id INTEGER NOT NULL,
        item_id TEXT NOT NULL,
        quantity INTEGER NOT NULL DEFAULT 0 CHECK(quantity >= 0),
        PRIMARY KEY (user_id, item_id),
        FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    );
`);

const SHOP_ITEMS = Object.freeze({
    eclipse_blade: { name: "Lâmina do Eclipse", price: 250 },
    shadow_bow: { name: "Arco das Sombras", price: 300 },
    guardian_armor: { name: "Armadura do Guardião", price: 400 },
    arcane_staff: { name: "Cajado Astral", price: 280 },
    summoner_talisman: { name: "Talismã do Invocador", price: 320 },
    paladin_shield: { name: "Escudo da Aurora", price: 350 },
    star_ring: { name: "Anel Estelar", price: 150 },
    arcane_amulet: { name: "Amuleto Arcano", price: 180 },
    vital_potion: { name: "Poção Vital", price: 50 },
    arcane_essence: { name: "Essência Arcana", price: 75 },
    arrow_common: { name: "Flecha Comum", price: 20, amount: 20, ammo: true },
    arrow_fire: { name: "Flecha Flamejante", price: 60, amount: 20, ammo: true },
    arrow_ice: { name: "Flecha Glacial", price: 60, amount: 20, ammo: true },
    arrow_poison: { name: "Flecha Venenosa", price: 70, amount: 20, ammo: true },
    arrow_lightning: { name: "Flecha Elétrica", price: 90, amount: 20, ammo: true },
    quiver_common: { name: "Aljava Comum", price: 120, slot: "quiver", rarity: "Comum" },
    quiver_rare: { name: "Aljava Rara", price: 350, slot: "quiver", rarity: "Rara" }
});
// Equipamentos persistentes por jogador; a aljava não duplica a munição do inventário.
db.exec(`
    CREATE TABLE IF NOT EXISTS player_equipment (
        user_id INTEGER PRIMARY KEY,
        main_hand TEXT,
        armor TEXT,
        off_hand TEXT,
        quiver TEXT,
        selected_arrow TEXT,
        quiver_upgrade INTEGER NOT NULL DEFAULT 0 CHECK(quiver_upgrade BETWEEN 0 AND 10),
        FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    );
`);
const EQUIPMENT_SLOTS = Object.freeze({
    eclipse_blade: "main_hand", shadow_bow: "main_hand", arcane_staff: "main_hand",
    guardian_armor: "armor", paladin_shield: "off_hand",
    summoner_talisman: "off_hand", quiver_common: "quiver", quiver_rare: "quiver"
});
const QUIVER_BASE = Object.freeze({quiver_common: 40, quiver_rare: 80});
const ensureEquipment = db.prepare("INSERT OR IGNORE INTO player_equipment(user_id) VALUES (?)");
const readEquipment = db.prepare("SELECT * FROM player_equipment WHERE user_id = ?");
const ownedQuantity = db.prepare("SELECT quantity FROM player_items WHERE user_id = ? AND item_id = ?");
const addItem = db.prepare(`INSERT INTO player_items (user_id, item_id, quantity) VALUES (?, ?, ?)
    ON CONFLICT(user_id, item_id) DO UPDATE SET quantity = quantity + excluded.quantity`);
const decrementItem = db.prepare("UPDATE player_items SET quantity = quantity - 1 WHERE user_id = ? AND item_id = ? AND quantity > 0");
const inventoryFor = userId => readItems.all(userId).filter(row => row.quantity > 0).map(row => ({
    id: row.item_id, name: SHOP_ITEMS[row.item_id]?.name || row.item_id,
    quantity: row.quantity, ammo: !!SHOP_ITEMS[row.item_id]?.ammo,
    slot: EQUIPMENT_SLOTS[row.item_id] || null
}));
function equipmentFor(userId) {
    ensureEquipment.run(userId);
    const eq = readEquipment.get(userId);
    return {
        main_hand: eq.main_hand, armor: eq.armor, off_hand: eq.off_hand,
        quiver: eq.quiver, selected_arrow: eq.selected_arrow,
        quiver_upgrade: eq.quiver_upgrade,
        quiver_capacity: eq.quiver ? QUIVER_BASE[eq.quiver] + eq.quiver_upgrade * 20 : 0,
        quiver_loaded: eq.selected_arrow ? Math.min(ownedQuantity.get(userId,eq.selected_arrow)?.quantity || 0,
            eq.quiver ? QUIVER_BASE[eq.quiver] + eq.quiver_upgrade * 20 : 0) : 0
    };
}
const ensureWallet = db.prepare(
    "INSERT OR IGNORE INTO player_wallets (user_id, astras) VALUES (?, 0)"
);
const readWallet = db.prepare(
    "SELECT astras FROM player_wallets WHERE user_id = ?"
);
const readItems = db.prepare(
    "SELECT item_id, quantity FROM player_items WHERE user_id = ? ORDER BY item_id"
);

// ==========================================
// SESSÕES
// ==========================================

const sessionSecret = process.env.SESSION_SECRET;

if (!sessionSecret) {
    console.warn(
        "AVISO: configure SESSION_SECRET para produção."
    );
}

app.use(session({
    name: "avantrox.sid",
    secret: sessionSecret ||
        crypto.randomBytes(32).toString("hex"),
    resave: false,
    saveUninitialized: false,
    cookie: {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        maxAge: 24 * 60 * 60 * 1000
    }
}));

// ==========================================
// LIMITADORES
// ==========================================

const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 10,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    message: {
        error: "Muitas tentativas. Aguarde alguns minutos."
    }
});

const profileLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 20,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    message: {
        error: "Muitas tentativas. Aguarde 15 minutos."
    }
});

const emailCodeLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 3,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    message: {
        error: "Limite de códigos atingido. Aguarde 15 minutos."
    }
});

// ==========================================
// FUNÇÕES DE VALIDAÇÃO
// ==========================================

function validUsername(username) {
    return typeof username === "string" &&
        /^[\p{L}\p{N}_-]{3,20}$/u.test(username);
}

function validEmail(email) {
    return typeof email === "string" &&
        email.length <= 254 &&
        /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function requireAuth(req, res, next) {
    if (!req.session.userId) {
        return res.status(401).json({
            error: "Você precisa fazer login."
        });
    }

    const exists = db.prepare(
        "SELECT id FROM users WHERE id = ?"
    ).get(req.session.userId);

    if (!exists) {
        return res.status(401).json({
            error: "Conta não encontrada."
        });
    }

    next();
}

function publicUser(user) {
    return {
        id: user.id,
        username: user.username,
        email: user.email,
        player_class: user.player_class,
        level: user.level,
        xp: user.xp,
        created_at: user.created_at
    };
}

// ==========================================
// SISTEMA DE XP
// ==========================================

function getRequiredXP(level) {
    return level * 100;
}

function getProgression(user) {
    const xpNeeded = getRequiredXP(user.level);

    return {
        level: user.level,
        xp: user.xp,
        xpNeeded,
        progress: Math.floor(
            (user.xp / xpNeeded) * 100
        ),
        canChangeClass:
            user.level >= 50 &&
            user.level % 50 === 0
    };
}

function addExperience(userId, amount) {
    if (
        !Number.isSafeInteger(amount) ||
        amount <= 0 ||
        amount > 1000000
    ) {
        throw new Error("Quantidade de XP inválida.");
    }

    return db.transaction(() => {
        const user = db.prepare(`
            SELECT level, xp
            FROM users
            WHERE id = ?
        `).get(userId);

        if (!user) {
            throw new Error("Jogador não encontrado.");
        }

        let level = user.level;
        let xp = user.xp + amount;
        let levelsGained = 0;

        while (xp >= getRequiredXP(level)) {
            xp -= getRequiredXP(level);
            level++;
            levelsGained++;
        }

        db.prepare(`
            UPDATE users
            SET level = ?, xp = ?
            WHERE id = ?
        `).run(level, xp, userId);

        return {
            ...getProgression({ level, xp }),
            levelsGained
        };
    })();
}

// ==========================================
// MISSÕES
// ==========================================

const MISSIONS = {
    first_login: {
        name: "Primeira Jornada",
        description:
            "Entre na sua conta pela primeira vez.",
        xp: 100
    },

    view_profile: {
        name: "Conhecendo seu Personagem",
        description:
            "Acesse seu perfil de jogador.",
        xp: 150
    },

    view_progression: {
        name: "O Caminho do Guerreiro",
        description:
            "Consulte sua progressão.",
        xp: 200
    }
};

// Recompensas só podem ser concedidas pelo servidor.

const completeMission = db.transaction(
    (userId, missionId) => {
        const mission = MISSIONS[missionId];

        if (!mission) {
            throw new Error("Missão inexistente.");
        }

        const result = db.prepare(`
            INSERT OR IGNORE INTO completed_missions
                (user_id, mission_id)
            VALUES (?, ?)
        `).run(userId, missionId);

        if (result.changes === 0) {
            return {
                completed: false,
                message: "Missão já concluída."
            };
        }

        const progression = addExperience(
            userId,
            mission.xp
        );

        return {
            completed: true,
            mission: mission.name,
            xpEarned: mission.xp,
            progression
        };
    }
);

// ==========================================
// CRIAR SESSÃO
// ==========================================

function createPlayerSession(req, res, user) {
    req.session.regenerate(error => {
        if (error) {
            return res.status(500).json({
                error: "Não foi possível iniciar a sessão."
            });
        }

        req.session.userId = user.id;

        req.session.save(saveError => {
            if (saveError) {
                return res.status(500).json({
                    error: "Não foi possível salvar a sessão."
                });
            }

            // Login no site não concede XP nem conclui missões.

            res.json({
                success: true,
                message: "Autenticação realizada com sucesso!",
                user: {
                    id: user.id,
                    username: user.username,
                    email: user.email
                }
            });
        });
    });
}

// Supabase Auth: somente a URL e a chave pública são necessárias aqui.
const SUPABASE_URL = (process.env.SUPABASE_URL || "").replace(/\/$/, "");
const SUPABASE_PUBLISHABLE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY || "";
async function supabaseAuth(endpoint, payload) {
    if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY) {
        const error = new Error("Configure SUPABASE_URL e SUPABASE_PUBLISHABLE_KEY no servidor.");
        error.status = 503;
        throw error;
    }
    const response = await fetch(`${SUPABASE_URL}/auth/v1/${endpoint}`, {
        method: "POST",
        headers: {
            apikey: SUPABASE_PUBLISHABLE_KEY,
            "Content-Type": "application/json"
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(15000)
    });
    const data = await response.json();
    if (!response.ok) {
        const error = new Error(data.msg || data.error_description || data.message || "Falha na autenticação.");
        error.status = response.status === 429 ? 429 : 400;
        throw error;
    }
    return data;
}

// ==========================================
// CADASTRO
// ==========================================

app.post("/api/auth/register", authLimiter, async (req, res) => {
    try {
        const { username, email, password } = req.body || {};
        const nick = typeof username === "string" ? username.trim() : "";
        const mail = typeof email === "string" ? email.trim().toLowerCase() : "";
        if (!validUsername(nick) || !validEmail(mail) ||
            typeof password !== "string" || password.length < 8 || password.length > 72) {
            return res.status(400).json({error:"Confira nick, e-mail e senha (mínimo 8 caracteres)."});
        }
        if (db.prepare("SELECT id FROM users WHERE username = ? OR email = ?").get(nick,mail)) {
            return res.status(409).json({error:"Nick ou e-mail já está cadastrado."});
        }
        const result = await supabaseAuth("signup", {
            email: mail, password,
            data: { username: nick }
        });
        // Supabase pode ocultar se um e-mail já existe; não criar conta local aqui.
        // A conta local é criada somente após login confirmado.
        return res.json({success:true, confirmationRequired:true,
            message:"Confira seu e-mail e clique no link de confirmação. Depois faça login."});
    } catch (error) {
        console.error("Falha no cadastro Supabase:", error.message);
        res.status(error.status || 500).json({error:error.message || "Falha ao criar conta."});
    }
});

app.post("/api/auth/login", authLimiter, async (req, res) => {
    try {
        const { identifier, password } = req.body || {};
        if (typeof identifier !== "string" || !validEmail(identifier.trim()) ||
            typeof password !== "string" || !password || password.length > 72) {
            return res.status(400).json({error:"Entre com seu e-mail e senha."});
        }
        const email = identifier.trim().toLowerCase();
        const auth = await supabaseAuth("token?grant_type=password", {email, password});
        if (!auth.access_token || !auth.user?.id || !auth.user.email_confirmed_at) {
            return res.status(403).json({error:"Confirme seu e-mail antes de entrar."});
        }
        let user = db.prepare("SELECT * FROM users WHERE supabase_id = ?").get(auth.user.id);
        if (!user) {
            // Nunca associar automaticamente uma conta antiga só pelo e-mail.
            if (db.prepare("SELECT id FROM users WHERE email = ?").get(email)) {
                return res.status(409).json({error:"Existe uma conta antiga com este e-mail. Solicite a migração antes de entrar."});
            }
            const proposed = auth.user.user_metadata?.username;
            const nick = validUsername(proposed) ? proposed : `jogador_${auth.user.id.slice(0,8)}`;
            if (db.prepare("SELECT id FROM users WHERE username = ?").get(nick)) {
                return res.status(409).json({error:"Este nick já está em uso. Entre em contato com o suporte."});
            }
            const placeholder = crypto.randomBytes(32).toString("hex");
            const inserted = db.prepare(`INSERT INTO users
                (username,email,password,player_class,level,xp,supabase_id)
                VALUES (?,?,?,'Não escolhida',1,0,?)`)
                .run(nick,email,placeholder,auth.user.id);
            user = db.prepare("SELECT * FROM users WHERE id = ?").get(inserted.lastInsertRowid);
        }
        createPlayerSession(req,res,user);
    } catch (error) {
        console.error("Falha no login Supabase:", error.message);
        res.status(error.status || 500).json({error:
            error.status === 400 ? "E-mail ou senha inválidos, ou e-mail ainda não confirmado." :
            error.message || "Não foi possível entrar."});
    }
});

// ==========================================
// DADOS DO JOGADOR
// ==========================================

app.get(
    "/api/auth/me",
    requireAuth,
    (req, res) => {
        try {

            const user = db.prepare(`
                SELECT *
                FROM users
                WHERE id = ?
            `).get(req.session.userId);

            res.json({
                authenticated: true,
                user: publicUser(user)
            });

        } catch (error) {
            console.error(
                "Erro ao carregar jogador:",
                error
            );

            res.status(500).json({
                error:
                    "Não foi possível carregar seu perfil."
            });
        }
    }
);

// ==========================================
// PROGRESSÃO DO JOGADOR
// ==========================================

app.get(
    "/api/player/progression",
    requireAuth,
    (req, res) => {
        try {

            const user = db.prepare(`
                SELECT level, xp
                FROM users
                WHERE id = ?
            `).get(req.session.userId);

            res.json(getProgression(user));

        } catch (error) {
            console.error("Erro na progressão:", error);

            res.status(500).json({
                error:
                    "Não foi possível carregar a progressão."
            });
        }
    }
);

// ==========================================
// LISTAR MISSÕES
// ==========================================

app.get(
    "/api/player/missions",
    requireAuth,
    (req, res) => {
        try {
            const completed = db.prepare(`
                SELECT mission_id, completed_at
                FROM completed_missions
                WHERE user_id = ?
            `).all(req.session.userId);

            const completedMap = new Map(
                completed.map(item => [
                    item.mission_id,
                    item.completed_at
                ])
            );

            const missions = Object.entries(
                MISSIONS
            ).map(([id, mission]) => ({
                id,
                name: mission.name,
                description: mission.description,
                xp: mission.xp,
                completed: completedMap.has(id),
                completedAt:
                    completedMap.get(id) || null
            }));

            res.json({
                success: true,
                missions
            });

        } catch (error) {
            console.error(
                "Erro ao listar missões:",
                error
            );

            res.status(500).json({
                error:
                    "Não foi possível carregar as missões."
            });
        }
    }
);

// A API pública do site não disponibiliza rotas para conceder XP.

// ==========================================
// ALTERAR NICK
// ==========================================

app.put(
    "/api/profile/username",
    requireAuth,
    profileLimiter,
    (req, res) => {
        const username =
            req.body?.username ??
            req.body?.newUsername;

        if (typeof username !== "string") {
            return res.status(400).json({
                error: "Informe o novo nick."
            });
        }

        const cleanUsername = username.trim();

        if (!validUsername(cleanUsername)) {
            return res.status(400).json({
                error:
                    "O nick deve ter de 3 a 20 caracteres."
            });
        }

        try {
            const result = db.prepare(`
                UPDATE users
                SET username = ?
                WHERE id = ?
            `).run(
                cleanUsername,
                req.session.userId
            );

            if (!result.changes) {
                return res.status(404).json({
                    error: "Conta não encontrada."
                });
            }

            res.json({
                success: true,
                username: cleanUsername,
                message: "Nick atualizado com sucesso!"
            });

        } catch (error) {
            if (
                error.code &&
                error.code.startsWith("SQLITE_CONSTRAINT")
            ) {
                return res.status(409).json({
                    error: "Esse nick já está em uso."
                });
            }

            console.error("Erro ao alterar nick:", error);

            res.status(500).json({
                error:
                    "Não foi possível alterar o nick."
            });
        }
    }
);

// ==========================================
// CONFIGURAÇÃO DE E-MAIL SMTP
// ==========================================

const smtpReady = [
    "SMTP_HOST",
    "SMTP_PORT",
    "SMTP_USER",
    "SMTP_PASS",
    "SMTP_FROM"
].every(key => Boolean(process.env[key]));

let mailTransport = null;

if (smtpReady) {
    try {
        const nodemailer = require("nodemailer");

        mailTransport = nodemailer.createTransport({
            host: process.env.SMTP_HOST,
            port: Number(process.env.SMTP_PORT),
            secure:
                Number(process.env.SMTP_PORT) === 465,
            auth: {
                user: process.env.SMTP_USER,
                pass: process.env.SMTP_PASS
            }
        });

    } catch (error) {
        console.error(
            "E-mail indisponível: instale nodemailer."
        );
    }
}

// ==========================================
// SOLICITAR CÓDIGO DE E-MAIL
// ==========================================

app.post(
    "/api/profile/email/request-code",
    requireAuth,
    emailCodeLimiter,
    async (req, res) => {
        const email =
            req.body?.email ??
            req.body?.newEmail;

        if (typeof email !== "string") {
            return res.status(400).json({
                error: "Informe o novo e-mail."
            });
        }

        const newEmail = email.trim().toLowerCase();

        if (!validEmail(newEmail)) {
            return res.status(400).json({
                error: "E-mail inválido."
            });
        }

        if (!mailTransport) {
            return res.status(503).json({
                error:
                    "Envio de e-mail não configurado no servidor."
            });
        }

        const existing = db.prepare(`
            SELECT id
            FROM users
            WHERE email = ?
        `).get(newEmail);

        if (existing) {
            return res.status(409).json({
                error:
                    "Este e-mail já está cadastrado."
            });
        }

        const code = String(
            crypto.randomInt(0, 1000000)
        ).padStart(6, "0");

        const codeHash = crypto
            .createHash("sha256")
            .update(`${req.session.userId}:${code}`)
            .digest("hex");

        const expiresAt =
            Date.now() + 10 * 60 * 1000;

        try {
            await mailTransport.sendMail({
                from: process.env.SMTP_FROM,
                to: newEmail,
                subject:
                    "AVANTROX - Confirmação de e-mail",
                text:
                    `Seu código AVANTROX é ${code}. ` +
                    "Válido por 10 minutos. " +
                    "Se você não solicitou esta alteração, " +
                    "ignore esta mensagem."
            });

            db.prepare(`
                INSERT INTO pending_email_changes
                    (
                        user_id,
                        new_email,
                        code_hash,
                        expires_at,
                        attempts
                    )
                VALUES (?, ?, ?, ?, 0)
                ON CONFLICT(user_id)
                DO UPDATE SET
                    new_email = excluded.new_email,
                    code_hash = excluded.code_hash,
                    expires_at = excluded.expires_at,
                    attempts = 0
            `).run(
                req.session.userId,
                newEmail,
                codeHash,
                expiresAt
            );

            res.json({
                success: true,
                message:
                    "Código enviado ao novo e-mail. " +
                    "Válido por 10 minutos."
            });

        } catch (error) {
            console.error(
                "Erro no envio do e-mail:",
                error
            );

            res.status(500).json({
                error:
                    "Não foi possível enviar o código."
            });
        }
    }
);

// ==========================================
// VERIFICAR CÓDIGO DE E-MAIL
// ==========================================

app.post(
    "/api/profile/email/verify-code",
    requireAuth,
    profileLimiter,
    (req, res) => {
        const code =
            req.body?.code ??
            req.body?.verificationCode;

        if (
            typeof code !== "string" ||
            !/^\d{6}$/.test(code)
        ) {
            return res.status(400).json({
                error:
                    "Digite o código de 6 dígitos."
            });
        }

        try {
            const pending = db.prepare(`
                SELECT *
                FROM pending_email_changes
                WHERE user_id = ?
            `).get(req.session.userId);

            if (
                !pending ||
                pending.expires_at < Date.now()
            ) {
                return res.status(400).json({
                    error:
                        "Código ausente ou expirado."
                });
            }

            if (pending.attempts >= 5) {
                return res.status(429).json({
                    error:
                        "Tentativas esgotadas. " +
                        "Solicite outro código."
                });
            }

            const suppliedHash = crypto
                .createHash("sha256")
                .update(`${req.session.userId}:${code}`)
                .digest();

            const expectedHash = Buffer.from(
                pending.code_hash,
                "hex"
            );

            if (
                expectedHash.length !== suppliedHash.length ||
                !crypto.timingSafeEqual(
                    suppliedHash,
                    expectedHash
                )
            ) {
                db.prepare(`
                    UPDATE pending_email_changes
                    SET attempts = attempts + 1
                    WHERE user_id = ?
                `).run(req.session.userId);

                return res.status(400).json({
                    error: "Código incorreto."
                });
            }

            const updateEmail = db.transaction(() => {
                db.prepare(`
                    UPDATE users
                    SET email = ?
                    WHERE id = ?
                `).run(
                    pending.new_email,
                    req.session.userId
                );

                db.prepare(`
                    DELETE FROM pending_email_changes
                    WHERE user_id = ?
                `).run(req.session.userId);
            });

            updateEmail();

            res.json({
                success: true,
                email: pending.new_email,
                message:
                    "E-mail atualizado com sucesso!"
            });

        } catch (error) {
            if (
                error.code &&
                error.code.startsWith("SQLITE_CONSTRAINT")
            ) {
                return res.status(409).json({
                    error:
                        "Este e-mail já está em uso."
                });
            }

            console.error(
                "Erro na confirmação do e-mail:",
                error
            );

            res.status(500).json({
                error:
                    "Não foi possível confirmar o e-mail."
            });
        }
    }
);

// ==========================================
// API DA LOJA - COMPRAS VALIDADAS NO SERVIDOR
// ==========================================
app.get("/api/shop", requireAuth, (req, res) => {
    const userId = req.session.userId;
    ensureWallet.run(userId);
    res.setHeader("Cache-Control", "no-store");
    res.json({
        astras: readWallet.get(userId).astras,
        inventory: inventoryFor(userId),
        equipment: equipmentFor(userId)
    });
});

const purchaseItem = db.transaction((userId, itemId) => {
    const item = SHOP_ITEMS[itemId];
    if (!item) return { error: "Item indisponível.", status: 400 };
    ensureWallet.run(userId);
    const changed = db.prepare(
        "UPDATE player_wallets SET astras = astras - ? WHERE user_id = ? AND astras >= ?"
    ).run(item.price, userId, item.price);
    if (!changed.changes) return { error: "Astras insuficientes.", status: 409 };
    addItem.run(userId, itemId, item.amount || 1);
    return {
        success: true,
        message: item.name + " adquirido!",
        astras: readWallet.get(userId).astras,
        inventory: inventoryFor(userId),
        equipment: equipmentFor(userId)
    };
});

app.post("/api/shop/buy", requireAuth, (req, res) => {
    const itemId = req.body?.itemId;
    if (typeof itemId !== "string" || itemId.length > 80) {
        return res.status(400).json({ error: "Item inválido." });
    }
    const result = purchaseItem(req.session.userId, itemId);
    if (result.error) return res.status(result.status).json({ error: result.error });
    res.setHeader("Cache-Control", "no-store");
    res.json(result);
});

// ==========================================
// INVENTÁRIO E EQUIPAMENTOS DO PERFIL
// ==========================================
app.get("/api/player/inventory", requireAuth, (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.json({ inventory: inventoryFor(req.session.userId), equipment: equipmentFor(req.session.userId) });
});

const equipPlayerItem = db.transaction((userId, itemId) => {
    const item = SHOP_ITEMS[itemId];
    if (!item || !(EQUIPMENT_SLOTS[itemId] || item.ammo)) return {error:"Item não equipável.",status:400};
    if ((ownedQuantity.get(userId,itemId)?.quantity || 0) < 1) return {error:"Você não possui esse item.",status:409};
    ensureEquipment.run(userId);
    const eq = readEquipment.get(userId);
    if (item.ammo) {
        if (!eq.quiver || eq.main_hand !== "shadow_bow") return {error:"Equipe o Arco das Sombras e uma aljava antes das flechas.",status:409};
        db.prepare("UPDATE player_equipment SET selected_arrow = ? WHERE user_id = ?").run(itemId,userId);
    } else {
        const slot = EQUIPMENT_SLOTS[itemId];
        if (slot === "quiver") {
            db.prepare("UPDATE player_equipment SET quiver = ?, quiver_upgrade = 0 WHERE user_id = ?").run(itemId,userId);
        } else {
            db.prepare(`UPDATE player_equipment SET ${slot} = ? WHERE user_id = ?`).run(itemId,userId);
        }
        if (slot === "main_hand" && itemId !== "shadow_bow") {
            db.prepare("UPDATE player_equipment SET selected_arrow = NULL WHERE user_id = ?").run(userId);
        }
    }
    return {success:true,inventory:inventoryFor(userId),equipment:equipmentFor(userId)};
});
app.post("/api/player/equip", requireAuth, (req,res) => {
    const itemId = req.body?.itemId;
    if (typeof itemId !== "string" || itemId.length > 80) return res.status(400).json({error:"Item inválido."});
    const result = equipPlayerItem(req.session.userId,itemId);
    if (result.error) return res.status(result.status).json({error:result.error});
    res.setHeader("Cache-Control","no-store");
    res.json(result);
});

// Simulação de disparo: futuramente deve ser chamada pelo servidor do jogo após validar a ação.
const fireArrow = db.transaction(userId => {
    const eq = equipmentFor(userId);
    if (eq.main_hand !== "shadow_bow" || !eq.quiver || !eq.selected_arrow)
        return {error:"Equipe arco, aljava e flechas.",status:409};
    if (!eq.quiver_loaded) return {error:"Sem flechas disponíveis na aljava.",status:409};
    const result = decrementItem.run(userId,eq.selected_arrow);
    if (!result.changes) return {error:"Munição insuficiente.",status:409};
    return {success:true,inventory:inventoryFor(userId),equipment:equipmentFor(userId)};
});
app.post("/api/player/fire-arrow", requireAuth, (req,res) => {
    const result = fireArrow(req.session.userId);
    if (result.error) return res.status(result.status).json({error:result.error});
    res.setHeader("Cache-Control","no-store");
    res.json(result);
});

const upgradeQuiver = db.transaction(userId => {
    const eq = equipmentFor(userId);
    if (!eq.quiver) return {error:"Equipe uma aljava.",status:409};
    if (eq.quiver_upgrade >= 10) return {error:"Aljava no nível máximo.",status:409};
    const price = 100 * (eq.quiver_upgrade + 1);
    ensureWallet.run(userId);
    const paid = db.prepare("UPDATE player_wallets SET astras = astras - ? WHERE user_id = ? AND astras >= ?")
        .run(price,userId,price);
    if (!paid.changes) return {error:`São necessários ${price} Astras.`,status:409};
    db.prepare("UPDATE player_equipment SET quiver_upgrade = quiver_upgrade + 1 WHERE user_id = ?").run(userId);
    return {success:true,astras:readWallet.get(userId).astras,equipment:equipmentFor(userId),inventory:inventoryFor(userId)};
});
app.post("/api/player/quiver/upgrade", requireAuth, (req,res) => {
    const result = upgradeQuiver(req.session.userId);
    if (result.error) return res.status(result.status).json({error:result.error});
    res.setHeader("Cache-Control","no-store");
    res.json(result);
});

// ==========================================
// LOGOUT
// ==========================================

app.post(
    "/api/auth/logout",
    requireAuth,
    (req, res) => {
        req.session.destroy(error => {
            if (error) {
                return res.status(500).json({
                    error:
                        "Não foi possível sair da conta."
                });
            }

            res.clearCookie("avantrox.sid");

            res.json({
                success: true,
                message: "Você saiu da sua conta."
            });
        });
    }
);

app.use((req, res, next) => {
    if (req.path.startsWith("/api/") || req.path === "/perfil.html") {
        res.setHeader("Cache-Control", "no-store");
    }
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    next();
});

// ==========================================
// PROTEGER PERFIL
// ==========================================

app.get(
    "/perfil.html",
    requireAuth,
    (req, res) => {
        res.sendFile(
            path.join(__dirname, "perfil.html")
        );
    }
);

// ==========================================
// ARQUIVOS DO SITE
// ==========================================

// Somente páginas públicas e recursos necessários ao site.
// Nunca disponibilizar server.js, package.json, .git ou arquivos de configuração.
const publicPages = new Set([
    "index.html", "cadastro.html", "login.html",
    "downloads.html", "loja.html", "recuperar-senha.html"
]);



app.get("/", (req, res) => {
    res.sendFile(path.join(__dirname, "index.html"));
});

app.get("/:page", (req, res, next) => {
    if (!publicPages.has(req.params.page)) return next();
    res.sendFile(path.join(__dirname, req.params.page));
});

app.get("/style.css", (req, res) => {
    res.type("css").sendFile(path.join(__dirname, "style.css"));
});

app.get("/script.js", (req, res) => {
    res.type("js").sendFile(path.join(__dirname, "script.js"));
});

app.use("/Assets", express.static(path.join(__dirname, "Assets"), {
    index: false,
    dotfiles: "deny"
}));

// ==========================================
// CLASSES E HABILIDADES (API PARA O JOGO)
// ==========================================
db.exec(`
    CREATE TABLE IF NOT EXISTS player_unlocked_skills (
        user_id INTEGER NOT NULL,
        skill_id TEXT NOT NULL,
        unlocked_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY(user_id, skill_id),
        FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    );
`);
const readSkills = db.prepare("SELECT skill_id FROM player_unlocked_skills WHERE user_id = ?");
const readSkillPlayer = db.prepare("SELECT player_class, level FROM users WHERE id = ?");

// Catálogo público: útil para wiki e telas de seleção de classe.
app.get("/api/classes", (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.json({classes:Object.entries(CLASSES).map(([name, data]) => ({
        name, role:data.role, secret:!!data.secret,
        baseStats:data.base,
        skills:data.skills.map(skill=>({...skill,cost:skill.cost||0}))
    }))});
});

app.get("/api/player/skills", requireAuth, (req, res) => {
    const user = readSkillPlayer.get(req.session.userId);
    const unlocked = readSkills.all(req.session.userId).map(row=>row.skill_id);
    const status = skillStatus(user.player_class, user.level, unlocked);
    if (!status) return res.status(409).json({error:"Classe do personagem inválida."});
    res.setHeader("Cache-Control", "no-store");
    res.json(status);
});

const unlockSkill = db.transaction((userId, skillId) => {
    const user = readSkillPlayer.get(userId);
    const skill = SKILL_INDEX.get(skillId);
    if (!skill || skill.className !== user.player_class)
        return {status:400,error:"Habilidade indisponível para sua classe."};
    if (skill.type === "basic")
        return {status:400,error:"Habilidades básicas são liberadas automaticamente."};
    const unlocked = readSkills.all(userId).map(row=>row.skill_id);
    if (unlocked.includes(skillId))
        return {status:409,error:"Habilidade já desbloqueada."};
    if (user.level < skill.level)
        return {status:403,error:`Nível ${skill.level} necessário.`};
    const state = skillStatus(user.player_class,user.level,unlocked);
    if (state.pointsAvailable < skill.cost)
        return {status:409,error:"Pontos de habilidade insuficientes."};
    db.prepare("INSERT INTO player_unlocked_skills (user_id, skill_id) VALUES (?, ?)").run(userId,skillId);
    return {success:true,message:`${skill.name} desbloqueada.`,
        ...skillStatus(user.player_class,user.level,[...unlocked,skillId])};
});

// Este endpoint apenas desbloqueia habilidades, não executa ataques.
app.post("/api/player/skills/unlock", requireAuth, (req,res) => {
    const skillId=req.body?.skillId;
    if(typeof skillId!=="string" || !/^[a-z_]{3,50}$/.test(skillId))
        return res.status(400).json({error:"Identificador de habilidade inválido."});
    try {
        const result=unlockSkill(req.session.userId,skillId);
        return res.status(result.status||200).json(result);
    } catch(error) {
        console.error("Erro ao desbloquear habilidade:",error);
        return res.status(500).json({error:"Não foi possível desbloquear a habilidade."});
    }
});

// ==========================================
// ATRIBUTOS: 3 PONTOS LIVRES POR NÍVEL
// ==========================================
const ATTRIBUTE_NAMES = Object.freeze(["forca", "vigor", "agilidade", "inteligencia", "fe"]);
const attributeColumns = ATTRIBUTE_NAMES.map(name => `${name} INTEGER NOT NULL DEFAULT 0 CHECK(${name} >= 0)`).join(",\n        ");
db.exec(`
    CREATE TABLE IF NOT EXISTS player_attributes (
        user_id INTEGER PRIMARY KEY,
        ${attributeColumns},
        FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    );
`);
const ensureAttributes = db.prepare("INSERT OR IGNORE INTO player_attributes (user_id) VALUES (?)");
const readAttributes = db.prepare("SELECT forca, vigor, agilidade, inteligencia, fe FROM player_attributes WHERE user_id = ?");
const readAttributePlayer = db.prepare("SELECT player_class, level FROM users WHERE id = ?");
const incrementAttribute = Object.fromEntries(ATTRIBUTE_NAMES.map(name => [name,
    db.prepare(`UPDATE player_attributes SET ${name} = ${name} + ? WHERE user_id = ?`)
]));

function attributeStatus(userId) {
    const user = readAttributePlayer.get(userId);
    if (!user) return null;
    const selected = CLASSES[user.player_class];
    if (!selected) return null;
    ensureAttributes.run(userId);
    const allocated = readAttributes.get(userId);
    const spent = ATTRIBUTE_NAMES.reduce((sum, name) => sum + allocated[name], 0);
    const earned = Math.max(0, (user.level - 1) * 3);
    const base = selected.base;
    const total = Object.fromEntries(ATTRIBUTE_NAMES.map(name => [name, base[name] + allocated[name]]));
    return {className:user.player_class, level:user.level, pointsEarned:earned,
        pointsSpent:spent, pointsAvailable:Math.max(0, earned-spent),
        base, allocated, total};
}

app.get("/api/player/attributes", requireAuth, (req, res) => {
    const state = attributeStatus(req.session.userId);
    if (!state) return res.status(409).json({error:"Classe inválida."});
    res.setHeader("Cache-Control", "no-store");
    res.json(state);
});

const allocateAttributes = db.transaction((userId, changes) => {
    const state = attributeStatus(userId);
    if (!state) return {status:409,error:"Classe inválida."};
    const amount = Object.values(changes).reduce((sum, value) => sum + value, 0);
    if (amount > state.pointsAvailable)
        return {status:409,error:"Pontos de atributo insuficientes."};
    for (const [name, value] of Object.entries(changes)) {
        if (value > 0) incrementAttribute[name].run(value, userId);
    }
    return {success:true, ...attributeStatus(userId)};
});

// O cliente só envia pontos para distribuir; nível e bônus são calculados no servidor.
app.post("/api/player/attributes/allocate", requireAuth, (req, res) => {
    const changes = req.body?.attributes;
    if (!changes || typeof changes !== "object" || Array.isArray(changes))
        return res.status(400).json({error:"Envie attributes como objeto."});
    const entries = Object.entries(changes);
    if (!entries.length || entries.length > ATTRIBUTE_NAMES.length ||
        entries.some(([name,value]) => !ATTRIBUTE_NAMES.includes(name) || !Number.isSafeInteger(value) || value < 0 || value > 3000) ||
        entries.every(([,value]) => value === 0))
        return res.status(400).json({error:"Distribuição de atributos inválida."});
    try {
        const result = allocateAttributes(req.session.userId, changes);
        return res.status(result.status || 200).json(result);
    } catch (error) {
        console.error("Erro ao distribuir atributos:", error);
        return res.status(500).json({error:"Não foi possível distribuir atributos."});
    }
});

// ==========================================
// INICIAR SERVIDOR
// ==========================================

app.listen(PORT, () => {
    console.log("--------------------------------");
    console.log("       AVANTROX ONLINE");
    console.log("--------------------------------");
    console.log(
        `Servidor: http://localhost:${PORT}`
    );
    console.log("Autenticação inicializada!");
    console.log("Banco de dados conectado!");
    console.log("Sistema de XP inicializado!");
    console.log("Sistema de missões inicializado!");
    console.log("Sistema de perfil inicializado!");
    console.log(
        "E-mail SMTP:",
        mailTransport ? "Configurado" : "Pendente"
    );
});