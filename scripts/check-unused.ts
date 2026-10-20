/**
 * Finds declarations that nothing uses, across the peinten library and the demo app at once.
 *
 *   node scripts/check-unused.ts           report; exits with 1 when something is unused
 *   node scripts/check-unused.ts --apply   remove unused declarations, unexport or privatize the rest, then
 *                                          type-check and roll every file back if that fails
 *
 * `typescript` resolves to typescript-native-bridge, which keeps a single live tsgo snapshot. Reference queries
 * therefore go through the program's `findReferencesTsgo`: ts-morph's language service would build a second program
 * and invalidate the snapshot the type checker uses.
 */
import { execFileSync } from 'node:child_process';
import { globSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { type ClassDeclaration, Node, Project, Scope, type SourceFile, SyntaxKind, ts } from 'ts-morph';

const ROOT = resolve(import.meta.dirname, '..');
const PEINTEN = `${ROOT}/packages/peinten`;
const DEMO = `${ROOT}/packages/demo`;
const WORKSPACES = ['peinten', 'demo'];
const APPLY = process.argv.includes('--apply');
/** A leading comment containing this keeps a declaration out of the report. */
const IGNORE_MARK = 'check-unused-ignore';

/** Files whose declarations are used from outside this analysis, so they are not checked themselves. */
const EXTERNALLY_USED = [
  // Library entry points: their exports are the public API.
  /\/packages\/peinten\/src\/(index|worker|tools|collab|exporting)\.ts$/,
  // Files that Next.js, Vitest or a Worker constructor load by convention.
  /\/src\/app\/(.*\/)?(page|layout|route|not-found|global-error|manifest)\.tsx?$/,
  /\/src\/mdx-components\.tsx$/,
  /\/\.next\//,
  /\/vitest\.config\.ts$/,
  /\.worker\.ts$/,
  // Mirrors of MDX imports, see mirrorMdxImports.
  /\.mdx\.imports\.tsx$/,
];

/** Members called by the runtime or by language protocols, never by name in this code base. */
const PROTOCOL_MEMBERS = new Set([
  'constructor',
  'dispose',
  'destroy',
  'toString',
  'toJSON',
  'valueOf',
  '[Symbol.dispose]',
  '[Symbol.asyncDispose]',
  '[Symbol.iterator]',
  '[Symbol.asyncIterator]',
]);

type Verdict = 'unused' | 'file-only' | 'class-only';

interface Finding {
  readonly file: string;
  readonly line: number;
  readonly verdict: Verdict;
  readonly what: string;
  /** Removes the declaration (unused) or narrows its visibility (file-only, class-only). */
  readonly fix: () => void;
}

/** Where a reference sits: its file and the start of the class that contains it (-1 outside classes). */
interface Site {
  readonly file: string;
  readonly classStart: number;
}

type Usage = 'unused' | 'inside' | 'outside';

/** Builds one program over both packages: peinten's tsconfig as the base, the demo's files on top. */
function createProject(): Project {
  // The base tsconfig must have inputs of its own: tsgo builds an empty program from a tsconfig whose
  // `include` matches nothing, even when files are added afterwards.
  const project = new Project({
    tsConfigFilePath: `${PEINTEN}/tsconfig.json`,
    compilerOptions: { jsx: ts.JsxEmit.ReactJSX, paths: { '@/*': [`${DEMO}/src/*`] } },
  });
  project.addSourceFilesAtPaths(`${DEMO}/src/**/*.{ts,tsx}`);
  mirrorMdxImports(project);
  return project;
}

/**
 * ts-morph cannot parse MDX, so the import statements of every MDX page are copied into an in-memory TypeScript
 * file. Components used only from MDX then count as used. Must run before the program is built.
 */
function mirrorMdxImports(project: Project): void {
  for (const page of globSync(`${DEMO}/src/**/*.mdx`)) {
    const imports = mdxImports(readFileSync(page, 'utf8'));
    if (imports.length > 0) project.createSourceFile(`${page}.imports.tsx`, imports.join('\n'), { overwrite: true });
  }
}

/** The ESM import statements of an MDX page. Imports inside fenced code blocks are examples, not imports. */
function mdxImports(source: string): string[] {
  const statements: string[] = [];
  let inFence = false;
  let pending: string[] | null = null;
  for (const line of source.split('\n')) {
    if (line.startsWith('```')) inFence = !inFence;
    if (inFence) continue;
    if (!pending && line.startsWith('import ')) pending = [];
    if (!pending) continue;
    pending.push(line);
    // A statement ends at its module specifier, which may follow a multi-line list of names.
    if (/(^import\s+|\bfrom\s+)['"][^'"]+['"]/.test(line)) {
      statements.push(pending.join('\n'));
      pending = null;
    }
  }
  return statements;
}

/**
 * Answers "is this declaration used, and from where?". A checker pass over every identifier settles most
 * declarations cheaply; it can prove that a reference exists but never that none does, so a tsgo reference query
 * decides the rest.
 */
class UsageIndex {
  readonly #project: Project;
  readonly #program: ts.Program & {
    findReferencesTsgo?(fileName: string, position: number): readonly ts.ReferencedSymbol[] | undefined;
  };
  readonly #sites = new Map<ts.Node, Site[]>();
  /** Property names accessed per file, to keep members used structurally (through other types) alive. */
  readonly #accessed = new Map<string, Set<string>>();

  constructor(project: Project, files: readonly SourceFile[]) {
    this.#project = project;
    this.#program = project.getProgram().compilerObject;
    const checker = project.getTypeChecker().compilerObject;
    for (const file of files) this.#indexFile(checker, file);
  }

  #indexFile(checker: ts.TypeChecker, file: SourceFile): void {
    const path = file.getFilePath();
    const classStarts: number[] = [];
    const visit = (node: ts.Node) => {
      const isClass = ts.isClassDeclaration(node);
      if (isClass) classStarts.push(node.getStart());
      if (ts.isIdentifier(node) || ts.isPrivateIdentifier(node)) {
        for (const declaration of declarationsOf(checker, node)) {
          // A declaration's own name is not a use of it.
          if ((declaration as { name?: ts.Node }).name === node) continue;
          const site = { file: path, classStart: classStarts.at(-1) ?? -1 };
          const sites = this.#sites.get(declaration);
          if (sites) sites.push(site);
          else this.#sites.set(declaration, [site]);
        }
      }
      ts.forEachChild(node, visit);
      if (isClass) classStarts.pop();
    };
    visit(file.compilerNode);

    for (const access of file.getDescendantsOfKind(SyntaxKind.PropertyAccessExpression)) {
      this.#addAccess(access.getName(), path);
    }
    for (const access of file.getDescendantsOfKind(SyntaxKind.ElementAccessExpression)) {
      const key = access.getArgumentExpression();
      if (Node.isStringLiteral(key) || Node.isNoSubstitutionTemplateLiteral(key)) {
        this.#addAccess(key.getLiteralText(), path);
      }
    }
  }

  #addAccess(name: string, file: string): void {
    const files = this.#accessed.get(name);
    if (files) files.add(file);
    else this.#accessed.set(name, new Set([file]));
  }

  /**
   * `isInside` defines the boundary (the declaring file, or the owning class). When `insideIsEnough` is set the
   * caller only cares about "unused", so a reference inside the boundary already answers the question.
   */
  usage(declaration: Node, isInside: (site: Site) => boolean, insideIsEnough: boolean): Usage {
    const sites = this.#sites.get(declaration.compilerNode) ?? [];
    if (sites.some((site) => !isInside(site))) return 'outside';
    if (sites.length > 0 && insideIsEnough) return 'inside';
    const references = this.#findReferences(declaration);
    if (references.length === 0) return 'unused';
    return references.every(isInside) ? 'inside' : 'outside';
  }

  accessedFromOtherFile(name: string, file: string): boolean {
    return [...(this.#accessed.get(name) ?? [])].some((accessor) => accessor !== file);
  }

  #findReferences(declaration: Node): Site[] {
    const name = (declaration as { getNameNode?(): Node | undefined }).getNameNode?.() ?? declaration;
    const symbols = this.#program.findReferencesTsgo?.(declaration.getSourceFile().getFilePath(), name.getStart());
    if (!symbols) throw new Error('check-unused needs the tsgo-backed `typescript` from typescript-native-bridge');
    return symbols.flatMap((symbol) =>
      symbol.references
        .filter((reference) => !reference.isDefinition)
        .map((reference) => {
          const node = this.#project.getSourceFile(reference.fileName)?.getDescendantAtPos(reference.textSpan.start);
          return {
            file: reference.fileName,
            classStart: node?.getFirstAncestorByKind(SyntaxKind.ClassDeclaration)?.getStart() ?? -1,
          };
        }),
    );
  }
}

function declarationsOf(checker: ts.TypeChecker, node: ts.Identifier | ts.PrivateIdentifier): readonly ts.Node[] {
  let symbol =
    ts.isShorthandPropertyAssignment(node.parent) && node.parent.name === node
      ? checker.getShorthandAssignmentValueSymbol(node.parent)
      : checker.getSymbolAtLocation(node);
  if (symbol && symbol.flags & ts.SymbolFlags.Alias) symbol = checker.getAliasedSymbol(symbol);
  return symbol?.getDeclarations() ?? [];
}

function isIgnored(node: Node): boolean {
  return node.getLeadingCommentRanges().some((comment) => comment.getText().includes(IGNORE_MARK));
}

/** Members an `implements` clause or a base class requires; removing them would break the contract. */
function isContractMember(owner: ClassDeclaration, name: string): boolean {
  if (owner.getImplements().some((contract) => contract.getType().getProperty(name))) return true;
  for (let base = owner.getBaseClass(); base; base = base.getBaseClass()) {
    if (base.getInstanceMember(name) ?? base.getStaticMember(name)) return true;
  }
  return false;
}

/** Checks the top-level declarations of a file and the members of its classes. */
function inspectFile(file: SourceFile, usages: UsageIndex): Finding[] {
  const path = file.getFilePath();
  const relative = path.slice(ROOT.length + 1);
  const findings: Finding[] = [];
  const inFile = (site: Site) => site.file === path;

  const topLevel = [
    ...file.getInterfaces().map((node) => ({ node, kind: 'interface', statement: node })),
    ...file.getTypeAliases().map((node) => ({ node, kind: 'type', statement: node })),
    ...file.getFunctions().map((node) => ({ node, kind: 'function', statement: node })),
    ...file.getClasses().map((node) => ({ node, kind: 'class', statement: node })),
    ...file
      .getVariableStatements()
      .flatMap((statement) => statement.getDeclarations().map((node) => ({ node, kind: 'const', statement }))),
  ];
  for (const { node, kind, statement } of topLevel) {
    const name = node.getName();
    if (!name || isIgnored(statement)) continue;
    // A default export is used by whatever imports the module, which references cannot always see.
    // The keyword is checked directly: `isExported()` asks the checker, which with the bridged tsgo program can report
    // a plain top-level const as exported.
    const narrowable = statement.hasExportKeyword() && !statement.hasDefaultKeyword();
    // Unexporting a statement that declares several variables would hide the others too.
    const canUnexport =
      narrowable && (!Node.isVariableStatement(statement) || statement.getDeclarations().length === 1);
    const usage = usages.usage(node, inFile, !narrowable);
    const line = node.getStartLineNumber();
    if (usage === 'unused') {
      findings.push({ file: relative, line, verdict: 'unused', what: `${kind} ${name}`, fix: () => node.remove() });
      continue;
    }
    if (usage === 'inside' && canUnexport) {
      findings.push({
        file: relative,
        line,
        verdict: 'file-only',
        what: `export ${kind} ${name}`,
        fix: () => statement.setIsExported(false),
      });
    }
    if (Node.isClassDeclaration(node)) findings.push(...inspectMembers(node, relative, usages));
  }
  return findings;
}

function inspectMembers(owner: ClassDeclaration, relative: string, usages: UsageIndex): Finding[] {
  const path = owner.getSourceFile().getFilePath();
  const ownerStart = owner.getStart();
  const inClass = (site: Site) => site.file === path && site.classStart === ownerStart;
  const className = owner.getName() ?? '(anonymous)';
  const findings: Finding[] = [];
  const members = [
    ...owner.getMethods(),
    ...owner.getProperties(),
    ...owner.getGetAccessors(),
    ...owner.getSetAccessors(),
  ];
  for (const member of members) {
    const name = member.getName();
    if (isIgnored(member) || PROTOCOL_MEMBERS.has(name) || isContractMember(owner, name)) continue;
    const scope = name.startsWith('#') ? Scope.Private : (member.getScope() ?? Scope.Public);
    const isPrivate = scope === Scope.Private;
    const usage = usages.usage(member, inClass, isPrivate);
    if (usage === 'outside') continue;
    // Public members may be reached through another type's property (structural typing), which references miss.
    if (!isPrivate && usages.accessedFromOtherFile(name, path)) continue;
    const what = `${scope}${member.isStatic() ? ' static' : ''} ${className}.${name}`;
    const line = member.getStartLineNumber();
    if (usage === 'unused') {
      findings.push({ file: relative, line, verdict: 'unused', what, fix: () => member.remove() });
    } else if (!isPrivate) {
      findings.push({ file: relative, line, verdict: 'class-only', what, fix: () => member.setScope(Scope.Private) });
    }
  }
  return findings;
}

function typecheck(when: string): void {
  for (const workspace of WORKSPACES) {
    try {
      execFileSync('pnpm', ['--filter', workspace, 'typecheck'], { cwd: ROOT, stdio: 'inherit' });
    } catch {
      throw new Error(`check-unused: ${workspace} does not type-check ${when}`);
    }
  }
}

const DESCRIPTION: Record<Verdict, string> = {
  unused: 'is unused',
  'file-only': 'is only used in its own file',
  'class-only': 'is only used inside its class',
};

function report(findings: readonly Finding[]): void {
  const byFile = Map.groupBy(findings, (finding) => finding.file);
  for (const [file, entries] of byFile) {
    console.log(`\n${file}`);
    for (const { line, verdict, what } of entries) {
      console.log(`  ${verdict === 'unused' ? 'error' : 'warn '}  L${line}  ${what} ${DESCRIPTION[verdict]}`);
    }
  }
  const unused = findings.filter((finding) => finding.verdict === 'unused').length;
  console.log(`\n${unused} unused, ${findings.length - unused} narrowable, in ${byFile.size} files`);
  if (unused > 0) process.exitCode = 1;
}

/** Analyzes a freshly built program of both packages. */
function analyze(): { project: Project; findings: Finding[] } {
  const project = createProject();
  const inPackages = project
    .getSourceFiles()
    .filter((file) => [PEINTEN, DEMO].some((dir) => file.getFilePath().startsWith(`${dir}/`)));
  // Skipped files still use the checked declarations, so every file feeds the index.
  const usages = new UsageIndex(project, inPackages);
  const findings = inPackages
    .filter((file) => !EXTERNALLY_USED.some((pattern) => pattern.test(file.getFilePath())))
    .flatMap((file) => inspectFile(file, usages));
  return { project, findings };
}

/** More rounds than this means the fixes keep producing work, which points at a bug in this script. */
const MAX_ROUNDS = 10;

/**
 * Fixes findings round by round: removing a declaration can leave the declarations it used unused, so the program
 * is rebuilt and analyzed again until a round finds nothing. Rolls every file back if the result does not
 * type-check.
 */
async function apply(): Promise<void> {
  typecheck('before the changes');
  const originals = new Map<string, string>();
  const applied: Finding[] = [];
  for (let round = 1; ; round++) {
    if (round > MAX_ROUNDS) throw new Error(`check-unused: still finding work after ${MAX_ROUNDS} rounds`);
    const { project, findings } = analyze();
    if (findings.length === 0) break;
    const touched = project
      .getSourceFiles()
      .filter((file) => findings.some((finding) => file.getFilePath().endsWith(finding.file)));
    for (const file of touched) {
      if (!originals.has(file.getFilePath())) originals.set(file.getFilePath(), file.getFullText());
    }
    for (const finding of findings) finding.fix();
    // Save only the edited files: the project also holds the in-memory MDX import mirrors.
    await Promise.all(touched.map((file) => file.save()));
    applied.push(...findings);
  }
  if (applied.length === 0) {
    console.log('Nothing to change');
    return;
  }
  try {
    typecheck('after the changes');
  } catch (error) {
    for (const [path, text] of originals) writeFileSync(path, text);
    throw error;
  }
  const count = (verdict: Verdict) => applied.filter((finding) => finding.verdict === verdict).length;
  console.log(
    `Removed ${count('unused')}, unexported ${count('file-only')}, privatized ${count('class-only')} ` +
      `in ${originals.size} files`,
  );
}

if (APPLY) await apply();
else report(analyze().findings);
