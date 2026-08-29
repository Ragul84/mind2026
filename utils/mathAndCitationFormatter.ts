/**
 * Utility for clean Math / LaTeX equation formatting, subscript/superscript conversion,
 * stacked fraction cleanup, and textbook citation badges.
 */

// Subscript dictionary: n_1 -> n₁, n_2 -> n₂
const SUB_MAP: Record<string, string> = {
  '0': '₀', '1': '₁', '2': '₂', '3': '₃', '4': '₄',
  '5': '₅', '6': '₆', '7': '₇', '8': '₈', '9': '₉',
  'i': 'ᵢ', 'r': 'ᵣ', 'm': 'ₘ', 'n': 'ₙ', 'a': 'ₐ', 'b': '♭', 'o': 'ₒ',
};

// Superscript dictionary: x^2 -> x², x^3 -> x³
const SUPER_MAP: Record<string, string> = {
  '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴',
  '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹',
  'n': 'ⁿ', '+': '⁺', '-': '⁻',
};

/**
 * Converts subscript (n_1, n_2, v_1, x_0) and superscript (x^2, cm^3) into clean Unicode symbols.
 * Also cleans raw LaTeX dollar wrappers like $n_2$ or \$n_2\$ or \(n_2\).
 */
export function formatSubscriptsAndSymbols(text: string): string {
  if (!text) return '';

  let result = text;

  // 1. Remove raw LaTeX dollar wrappers and delimiters: $n_2$, \$n_2\$, \(n_2\), \[n_2\]
  result = result.replace(/\\\$/g, '');
  result = result.replace(/\\\(|\x5C\x28/g, '');
  result = result.replace(/\\\x29|\x5C\x29/g, '');
  result = result.replace(/\\\[|\x5C\x5B/g, '');
  result = result.replace(/\\\]|\x5C\x5D/g, '');
  result = result.replace(/\$\$(.*?)\$\$/g, '$1');
  result = result.replace(/\$([^$\n]+)\$/g, '$1');

  // 2. Replace Greek & math symbols: \theta -> θ, \alpha -> α, \lambda -> λ, \times -> ×
  result = result.replace(/\\theta/g, 'θ');
  result = result.replace(/\\alpha/g, 'α');
  result = result.replace(/\\beta/g, 'β');
  result = result.replace(/\\gamma/g, 'γ');
  result = result.replace(/\\delta/g, 'δ');
  result = result.replace(/\\lambda/g, 'λ');
  result = result.replace(/\\mu/g, 'μ');
  result = result.replace(/\\pi/g, 'π');
  result = result.replace(/\\rho/g, 'ρ');
  result = result.replace(/\\sigma/g, 'σ');
  result = result.replace(/\\omega/g, 'ω');
  result = result.replace(/\\Delta/g, 'Δ');
  result = result.replace(/\\Omega/g, 'Ω');
  result = result.replace(/\\sqrt\{?([^}\n]+)\}?/g, '√($1)');
  result = result.replace(/\\times/g, '×');
  result = result.replace(/\\div/g, '÷');
  result = result.replace(/\\pm/g, '±');
  result = result.replace(/\\approx/g, '≈');
  result = result.replace(/\\neq/g, '≠');
  result = result.replace(/\\degree|\\\^\x7B\x5Ccirc\x7D/g, '°');

  // 3. Replace Subscripts: n_1 -> n₁, n_2 -> n₂, v_1 -> v₁, f_1 -> f₁, t_2 -> t₂
  result = result.replace(/([a-zA-Z])_([0-9inmrab])/g, (match, letter, sub) => {
    return letter + (SUB_MAP[sub] || `_${sub}`);
  });

  // 4. Replace Superscripts: x^2 -> x², x^3 -> x³, cm^2 -> cm²
  result = result.replace(/([a-zA-Z0-9\)\}\]])\^([0-9n\+\-])/g, (match, base, sup) => {
    return base + (SUPER_MAP[sup] || `^${sup}`);
  });

  return result;
}

/**
 * Formats mathematical equations, cleans raw LaTeX delimiters,
 * formats fractions like (1)/(f) -> 1/f, and splits multi-step algebraic solutions onto separate lines.
 */
export function formatMathAndEquations(text: string): string {
  if (!text) return '';

  let result = formatSubscriptsAndSymbols(text);

  // 1. Format LaTeX fractions: \frac{num}{den} -> (num) / (den) or clean num/den
  result = result.replace(/\\frac\{([^{}]+)\}\{([^{}]+)\}/g, (match, num, den) => {
    const cleanNum = formatSubscriptsAndSymbols(num.trim());
    const cleanDen = formatSubscriptsAndSymbols(den.trim());
    if (/^[a-zA-Z0-9₀-₉α-ωΑ-Ω]+$/.test(cleanNum) && /^[a-zA-Z0-9₀-₉α-ωΑ-Ω]+$/.test(cleanDen)) {
      return `${cleanNum}/${cleanDen}`;
    }
    return `(${cleanNum})/(${cleanDen})`;
  });

  // 2. Clean ugly parenthesized single-letter/number fractions: (1)/(f) -> 1/f, (1)/(v) -> 1/v, (1)/(u) -> 1/u
  result = result.replace(/\(([a-zA-Z0-9₀-₉α-ωΑ-Ω\+\-\*\s]+)\)\/\(([a-zA-Z0-9₀-₉α-ωΑ-Ω\+\-\*\s]+)\)/g, '$1/$2');
  result = result.replace(/\(([a-zA-Z0-9₀-₉α-ωΑ-Ω\+\-\*\s]+)\)\/([a-zA-Z0-9₀-₉α-ωΑ-Ω\+\-\*\s]+)/g, '$1/$2');
  result = result.replace(/([a-zA-Z0-9₀-₉α-ωΑ-Ω\+\-\*\s]+)\/\(([a-zA-Z0-9₀-₉α-ωΑ-Ω\+\-\*\s]+)\)/g, '$1/$2');

  // 3. Format math spacing around operators (=, +, -, *, /) for readability
  result = result.replace(/([a-zA-Z0-9₀-₉α-ωΑ-Ω])=([a-zA-Z0-9₀-₉α-ωΑ-Ω\+\-])/g, '$1 = $2');

  // 4. Break multi-equal or multi-step algebraic expressions onto separate lines
  result = result.replace(/([^\n=]+=[^\n=]+)=([^\n=]+)/g, (match, p1, p2) => {
    return `${p1.trim()}\n⇒ ${p2.trim()}`;
  });

  return result;
}

/**
 * Transforms generic or raw citations like:
 *   "Ref: SAMACHEER Class 12 physics"
 *   "Ref: NCERT Class 10 science"
 *   "Source: Samacheer Kalvi Class 12"
 * Into structured, authoritative textbook source badges:
 *   "📘 Source: Samacheer Kalvi • Class 12 Physics • Volume II • Ray Optics & Optical Instruments"
 */
export function formatTextbookCitation(text: string): string {
  if (!text) return '';

  let result = text;

  // Regex matching various "Ref:", "Reference:", "Source:" patterns
  const citationRegex = /(?:Ref|Reference|Source)\s*:\s*([^.\n]+(?:\.|\n|$))/gi;

  result = result.replace(citationRegex, (fullMatch, rawCitation) => {
    const clean = rawCitation.replace(/[.\n]/g, '').trim();
    if (!clean) return fullMatch;

    const lower = clean.toLowerCase();
    let publisher = '';
    let cls = '';
    let subject = '';
    let volumeOrChapter = '';

    // Detect Publisher
    if (lower.includes('samacheer') || lower.includes('tn') || lower.includes('tamil nadu')) {
      publisher = 'Samacheer Kalvi';
    } else if (lower.includes('ncert') || lower.includes('cbse')) {
      publisher = 'NCERT';
    } else if (lower.includes('state board')) {
      publisher = 'State Board Textbook';
    } else {
      publisher = clean.split(' ')[0] || 'Textbook Standard';
    }

    // Detect Class
    const classMatch = lower.match(/(?:class|std|grade)\s*(\d{1,2})/i) || lower.match(/\b(10|11|12|6|7|8|9)\b/);
    if (classMatch) {
      cls = `Class ${classMatch[1]}`;
    }

    // Detect Subject & Topic/Volume Details
    if (lower.includes('physic')) {
      subject = 'Physics';
      if (lower.includes('optic') || lower.includes('lens') || lower.includes('light')) {
        volumeOrChapter = 'Volume II • Ray Optics & Optical Instruments';
      } else if (lower.includes('electric') || lower.includes('magnet')) {
        volumeOrChapter = 'Volume I • Electrostatics & Magnetism';
      }
    } else if (lower.includes('chemistr')) {
      subject = 'Chemistry';
    } else if (lower.includes('biolog') || lower.includes('botan') || lower.includes('zoolog')) {
      subject = 'Biology';
    } else if (lower.includes('math')) {
      subject = 'Mathematics';
    } else if (lower.includes('polity') || lower.includes('constitution')) {
      subject = 'Indian Polity';
    } else if (lower.includes('histor')) {
      subject = 'History';
    } else if (lower.includes('geograph')) {
      subject = 'Geography';
    } else if (lower.includes('scienc')) {
      subject = 'Science';
      if (lower.includes('light') || lower.includes('reflect') || lower.includes('refract')) {
        volumeOrChapter = 'Chapter: Light – Reflection & Refraction';
      }
    }

    // Construct enriched badge components
    const parts = ['📘 Source: ' + publisher];
    if (cls) parts.push(cls);
    if (subject) parts.push(subject);
    if (volumeOrChapter) {
      parts.push(volumeOrChapter);
    } else {
      const remaining = clean
        .replace(/samacheer|kalvi|ncert|class|std|grade|\d{1,2}|physics|chemistry|biology|science|maths|ref|source/gi, '')
        .replace(/[-:]/g, '')
        .trim();
      if (remaining && remaining.length > 2) {
        parts.push(remaining);
      }
    }

    return parts.join(' • ') + '\n';
  });

  return result;
}

/**
 * Combined master content cleanser for AI text outputs and lesson markdown.
 * Cleans LaTeX, converts subscripts/superscripts (n_2 -> n₂), formats equations,
 * and upgrades textbook reference citations.
 */
export function formatContentWithMathAndCitations(content: string): string {
  if (!content) return '';
  let formatted = formatMathAndEquations(content);
  formatted = formatTextbookCitation(formatted);
  return formatted;
}
