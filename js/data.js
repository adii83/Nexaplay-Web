/* ============================================================
   DATA.JS — NexaPlay Dummy Game Data
   ============================================================
   EDIT THIS FILE to replace placeholder data with real game info.
   Each game object follows this structure:
   {
     id:        Number   — unique identifier
     title:     String   — game title
     category:  String   — "Premium" or "Standard"
     trending:  Boolean  — show in trending section
     rank:      Number   — trending rank (1-10), null if not trending
   }
   ============================================================ */

const GAMES_DATA = [
  // ── Trending Games ──
  { id: 1,  title: "Elden Ring",                 category: "Premium",  trending: true,  rank: 1  },
  { id: 2,  title: "Cyberpunk 2077",             category: "Premium",  trending: true,  rank: 2  },
  { id: 3,  title: "Red Dead Redemption 2",      category: "Premium",  trending: true,  rank: 3  },
  { id: 4,  title: "Hogwarts Legacy",            category: "Premium",  trending: true,  rank: 4  },
  { id: 5,  title: "God of War Ragnarök",        category: "Premium",  trending: true,  rank: 5  },
  { id: 6,  title: "Baldur's Gate 3",            category: "Premium",  trending: true,  rank: 6  },
  { id: 7,  title: "Starfield",                  category: "Premium",  trending: true,  rank: 7  },
  { id: 8,  title: "The Witcher 3: Wild Hunt",   category: "Premium",  trending: true,  rank: 8  },
  { id: 9,  title: "GTA V",                      category: "Standard", trending: true,  rank: 9  },
  { id: 10, title: "Resident Evil 4 Remake",     category: "Premium",  trending: true,  rank: 10 },

  // ── Standard Games ──
  { id: 11, title: "Stardew Valley",             category: "Standard", trending: false, rank: null },
  { id: 12, title: "Hollow Knight",              category: "Standard", trending: false, rank: null },
  { id: 13, title: "Hades",                      category: "Standard", trending: false, rank: null },
  { id: 14, title: "Terraria",                   category: "Standard", trending: false, rank: null },
  { id: 15, title: "Celeste",                    category: "Standard", trending: false, rank: null },
  { id: 16, title: "Undertale",                  category: "Standard", trending: false, rank: null },
  { id: 17, title: "Portal 2",                   category: "Standard", trending: false, rank: null },
  { id: 18, title: "Disco Elysium",              category: "Standard", trending: false, rank: null },

  // ── Premium Games ──
  { id: 19, title: "Alan Wake 2",                category: "Premium",  trending: false, rank: null },
  { id: 20, title: "Spider-Man Remastered",      category: "Premium",  trending: false, rank: null },
  { id: 21, title: "Star Wars Jedi: Survivor",   category: "Premium",  trending: false, rank: null },
  { id: 22, title: "Horizon Forbidden West",     category: "Premium",  trending: false, rank: null },
  { id: 23, title: "Death Stranding",            category: "Premium",  trending: false, rank: null },
  { id: 24, title: "Armored Core VI",            category: "Premium",  trending: false, rank: null },
  { id: 25, title: "Lies of P",                  category: "Premium",  trending: false, rank: null },
  { id: 26, title: "Remnant II",                 category: "Premium",  trending: false, rank: null },
  { id: 27, title: "Atomic Heart",               category: "Premium",  trending: false, rank: null },
  { id: 28, title: "Returnal",                   category: "Premium",  trending: false, rank: null },
  { id: 29, title: "Final Fantasy XVI",          category: "Premium",  trending: false, rank: null },
  { id: 30, title: "Dead Space Remake",          category: "Premium",  trending: false, rank: null },
];

/* ── Publisher names for marquee ── */
const PUBLISHERS = [
  "Electronic Arts",
  "Ubisoft",
  "Rockstar Games",
  "Bethesda",
  "Square Enix",
  "Bandai Namco",
  "Capcom",
  "CD Projekt",
  "FromSoftware",
  "Valve",
  "2K Games",
  "Activision",
  "Warner Bros.",
  "Sony Interactive",
  "Xbox Game Studios",
  "SEGA",
];

/* ── FAQ Data for Showcase Page ── */
const FAQ_DATA = [
  {
    question: "Apa itu NexaPlay?",
    answer: "NexaPlay adalah platform akses game digital premium yang memberi kamu pintu masuk ke lebih dari 95.000 judul game Steam. Dengan satu kali pembelian, seluruh koleksi langsung tersedia di library pribadi kamu — tanpa proses rumit, tanpa biaya tambahan, tanpa batas waktu."
  },
  {
    question: "Apakah aman digunakan, tidak ada risiko banned?",
    answer: "Keamanan adalah prioritas utama kami. NexaPlay menggunakan metode akses yang bekerja di luar jangkauan sistem deteksi platform. Selama kamu mengikuti panduan penggunaan yang kami sediakan, risiko gangguan terhadap akun utamamu praktis nol. Ribuan pengguna aktif kami membuktikannya setiap hari."
  },
  {
    question: "Bagaimana proses pengiriman produk setelah pembelian?",
    answer: "Setelah pembayaran dikonfirmasi, kamu akan langsung menerima akses lengkap beserta panduan setup step-by-step yang mudah diikuti. Seluruh proses — dari pembelian sampai game siap dimainkan — biasanya selesai dalam hitungan menit, bukan jam."
  },
  {
    question: "Apa itu proteksi Denuvo dan kenapa penting?",
    answer: "Denuvo adalah sistem proteksi anti-tamper yang digunakan publisher besar untuk mengamankan game mereka. Game dengan proteksi ini biasanya lebih sulit diakses melalui metode konvensional. Paket Premium NexaPlay secara khusus dirancang untuk mengatasi batasan ini, memberi kamu akses penuh ke judul-judul AAA terbaru yang dilindungi Denuvo."
  },
  {
    question: "Apakah game dengan proteksi Denuvo tetap bisa dimainkan?",
    answer: "Absolutely. Dengan paket Premium, game ber-Denuvo bisa kamu mainkan tanpa hambatan apapun. Sistem kami secara otomatis menangani proses bypass sehingga pengalaman bermainmu sama persis seperti membeli game langsung — zero difference."
  },
  {
    question: "Bagaimana dengan game yang pakai launcher pihak ketiga?",
    answer: "Game yang memerlukan launcher seperti EA App, Ubisoft Connect, atau Rockstar Launcher tetap bisa diakses. Paket Premium memberikan kompatibilitas penuh dengan semua launcher pihak ketiga major, sementara paket Standard memiliki dukungan terbatas untuk beberapa launcher tertentu."
  },
  {
    question: "Apa yang harus dilakukan kalau ada kendala atau error?",
    answer: "Tim support NexaPlay siap membantu 24/7. Cukup hubungi kami melalui channel yang tersedia, dan tim teknis kami akan memandu kamu menyelesaikan masalah apapun secepat mungkin. Mayoritas kendala terselesaikan dalam sesi pertama — kami tidak percaya pada template jawaban generik."
  },
  {
    question: "Bisakah digunakan di lebih dari satu perangkat?",
    answer: "Setiap lisensi NexaPlay dirancang untuk satu perangkat utama. Ini memastikan stabilitas optimal dan keamanan akunmu. Jika kamu perlu berpindah perangkat, hubungi support kami dan kami akan bantu proses migrasi dengan cepat."
  },
  {
    question: "Apakah kompatibel dengan Steam Deck atau perangkat lain?",
    answer: "NexaPlay kompatibel dengan semua perangkat yang menjalankan Steam di platform Windows. Untuk Steam Deck dan perangkat berbasis Linux, dukungan tersedia dengan beberapa penyesuaian teknis — tim kami siap membantu setup-nya. Kami terus mengembangkan kompatibilitas untuk lebih banyak platform."
  },
];
