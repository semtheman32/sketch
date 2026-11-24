// Mechanisme-tekenopdrachten OSY2. Alleen de opgave: uitgangsstoffen (en wat de opgave zelf al geeft), nooit het antwoord.
const S = s => ({ smiles: s })
const Q = { smiles: '?' }
const step = (species, above, below) => ({ species: species.map(S), ...(above || below ? { then: { above: above ?? '', below: below ?? '' } } : {}) })
const toQ = (species, above, below) => [step(species, above, below), { species: [Q] }]
const given = (from, to, above, below) => [step(from, above ?? ' ', below), { species: to.map(S) }]

export const SECTIONS = [
 { title: 'Les 1 · Additiereacties (1)', color: '#2563eb', items: [
  { t: '1.1 · Werkcollege les 1, opgave 1', q: 'Geef het mechanisme van de reactie van cyclohexeen met HCl.', steps: toQ(['C1=CCCCC1'], 'HCl') },
  { lp: 'heteroatoms', t: '1.2 · Werkcollege les 1, opgave 8a', q: 'Teken de gebogen pijlen. Geef aan wat het elektrofiel en wat het nucleofiel is.', steps: given(['C[CH+]C', '[Cl-]'], ['CC(C)Cl']) },
  { lp: 'heteroatoms', t: '1.3 · Werkcollege les 1, opgave 8b', q: 'Teken de gebogen pijlen. Geef aan wat het elektrofiel en wat het nucleofiel is.', steps: given(['C=CC', 'Br'], ['C[CH+]C', '[Br-]']) },
  { lp: 'heteroatoms', t: '1.4 · Werkcollege les 1, opgave 8c', q: 'Teken de gebogen pijlen. Geef aan wat het elektrofiel en wat het nucleofiel is.', steps: given(['C=CC', 'B'], ['CCCB']) },
  { lp: 'heteroatoms', t: '1.5 · Werkcollege les 1, opgave 9a', q: 'Teken de gebogen pijlen.', steps: given(['CC(C)([O-])OC'], ['CC(C)=O', 'C[O-]']) },
  { lp: 'heteroatoms', t: '1.6 · Werkcollege les 1, opgave 9b', q: 'Teken de gebogen pijlen.', steps: given(['CC#C', '[NH2-]'], ['CC#[C-]', 'N']) },
  { lp: 'heteroatoms', t: '1.7 · Werkcollege les 1, opgave 9c', q: 'Teken de gebogen pijlen.', steps: given(['CCBr', 'C[O-]'], ['CCOC', '[Br-]']) },
 ]},
 { title: 'Les 3 · Kinetiek', color: '#7c3aed', items: [
  { t: '3.1 · Werkcollege les 3, Wade 4-11', q: 'Geef het mechanisme van de reactie van tert-butylchloride in methanol.', steps: toQ(['CC(C)(C)Cl'], 'CH₃OH') },
  { t: '3.2 · Werkcollege les 3, Wade 4-34', q: 'Geef het mechanisme van de reactie van 1-broompropaan met methoxide.', steps: toQ(['CCCBr', 'C[O-]']) },
  { t: '3.3 · Werkcollege les 3, Wade 7-60a', q: 'Geef het mechanisme met natriummethoxide en teken het energiediagram.', steps: toQ(['CC(C)C(C)(C)Br'], 'NaOCH₃') },
  { t: '3.4 · Werkcollege les 3, Wade 7-60b', q: 'Geef het mechanisme bij verwarmen in methanol (zonder sterke base) en teken het energiediagram.', steps: toQ(['CC(C)C(C)(C)Br'], 'CH₃OH', 'Δ') },
 ]},
 { title: 'Les 4 · Reactiesturing substitutie-eliminatie', color: '#0891b2', items: [
  { t: '4.1 · Werkcollege les 4, Wade 7-17a', q: 'Geef het mechanisme van de solvolyse in methanol.', steps: toQ(['CC(C)(Br)C(C)(C)C'], 'CH₃OH') },
  { t: '4.2 · Werkcollege les 4, Wade 7-49b', q: 'Geef het mechanisme van de zuurgekatalyseerde dehydratatie, voor elk alkeen dat kan ontstaan.', steps: toQ(['CC(O)C1CCCCC1'], 'H₂SO₄', 'Δ') },
  { t: '4.3 · Werkcollege les 4, Wade 7-49c', q: 'Geef het mechanisme van de zuurgekatalyseerde dehydratatie, voor elk alkeen dat kan ontstaan.', steps: toQ(['CC(O)C(C)(C)C'], 'H₂SO₄', 'Δ') },
 ]},
 { title: 'Les 8 · Additiereacties (2)', color: '#16a34a', items: [
  { t: '8.1 · Werkcollege les 8, Wade 8-3a', q: 'Geef het mechanisme (initiatie en propagatie) en het hoofdproduct.', steps: toQ(['CC1=CCCC1'], 'HBr', 'CH₃CO-OO-COCH₃, Δ') },
  { t: '8.2 · Werkcollege les 8, Wade 8-3b', q: 'Geef het mechanisme (initiatie en propagatie) en het hoofdproduct.', steps: toQ(['C/C=C/c1ccccc1'], 'HBr', '(CH₃)₃CO-OC(CH₃)₃, Δ') },
  { t: '8.3 · Werkcollege les 8, Wade 8-18a', q: 'Geef het mechanisme en de producten met stereochemie.', steps: toQ(['C1=CCCCCC1'], 'Br₂') },
  { t: '8.4 · Werkcollege les 8, Wade 8-18b', q: 'Geef het mechanisme voor de additie aan beide dubbele bindingen en de producten met stereochemie.', steps: toQ(['CC1=CCC(CC1)C(C)=C'], 'Br₂ (overmaat)') },
  { t: '8.5 · Werkcollege les 8, Wade 8-18c', q: 'Geef het mechanisme en de producten met stereochemie.', steps: toQ(['CC/C=C/CCCCCC'], 'Br₂') },
  { t: '8.6 · Werkcollege les 8, Wade 8-18d', q: 'Geef het mechanisme en de producten met stereochemie.', steps: toQ(['CC/C=C\\CCCCCC'], 'Br₂') },
  { t: '8.7 · Werkcollege les 8, Wade 8-19', q: 'Geef het mechanisme en de producten met stereochemie.', steps: toQ(['C1=CCCC1'], 'Br₂', 'H₂O') },
 ]},
 { title: 'Les 11 · Epoxides', color: '#ea580c', items: [
  { t: '11.1 · Werkcollege les 11, Wade 14-27a', q: 'Geef het mechanisme en laat zien waar het ¹⁸O terechtkomt.', steps: toQ(['CC1(C)CO1'], 'H⁺', 'H₂¹⁸O') },
  { t: '11.2 · Werkcollege les 11, Wade 14-27b', q: 'Geef het mechanisme en laat zien waar het ¹⁸O terechtkomt.', steps: toQ(['CC1(C)CO1'], '¹⁸OH⁻', 'H₂¹⁸O') },
  { t: '11.3 · Werkcollege les 11, Wade 14-27c', q: 'Geef het mechanisme voor (2S,3R)-2-ethyl-2,3-dimethyloxiraan en het product met stereochemie.', steps: toQ(['CC[C@]1(C)O[C@@H]1C'], 'CH₃O⁻', 'CH₃OH') },
  { t: '11.4 · Werkcollege les 11, Wade 14-27d', q: 'Geef het mechanisme voor (2S,3R)-2-ethyl-2,3-dimethyloxiraan en het product met stereochemie.', steps: toQ(['CC[C@]1(C)O[C@@H]1C'], 'H⁺', 'CH₃OH') },
 ]},
 { title: 'Les 15 · Grignard', color: '#db2777', items: [
  { t: '15.1 · Les 15, vraag 7 (werkwijze lit. 24)', q: 'Geef het mechanisme van ethylmagnesiumbromide (overmaat) met diethylcarbonaat, tot en met de opwerking.', steps: toQ(['CC[Mg]Br', 'CCOC(=O)OCC'], 'droge MTBE', 'daarna NH₄Cl (aq)') },
 ]},
 { title: 'Vaardigheden (werkplan: teken het reactiemechanisme)', color: '#4d7c0f', items: [
  { t: 'VD1 · Bromering van (E)-stilbeen', q: 'Geef het mechanisme via het bromoniumion en via het carbokation, en de producten met stereochemie (meso of dl).', steps: toQ(['c1ccc(cc1)/C=C/c1ccccc1'], 'Br₂') },
  { t: 'VD4 · Synthese van benzoëzuur', q: 'Geef het mechanisme van fenylmagnesiumbromide met CO₂, tot en met het aanzuren.', steps: toQ(['Br[Mg]c1ccccc1', 'O=C=O'], '1) droge ether', '2) H₃O⁺') },
 ]},
 { title: 'Oefencasus Lavendel', color: '#9333ea', items: [
  { t: 'Lavendel · vraag 8', q: 'Geef het mechanisme van de synthese van (+)-linalool.', steps: toQ(['ClCCC=C(C)C', 'C=CC(C)=O'], 'Li, ether, N₂', '−70 °C, daarna opwerken') },
  { t: 'Lavendel · vraag 9', q: 'Geef het volledige mechanisme van de cyclisatie van (−)-lavandulol tot lavendeloxide.', steps: given(['CC(C)=CCC(CO)C(C)=C'], ['CC(=C)C1CCC(C)(C)OC1'], 'zure katalysator') },
  { t: 'Lavendel · vraag 11', q: 'Geef het volledige mechanisme wanneer het epoxide via een halohydrine gemaakt wordt.', steps: given(['CC(=C)C1CCC(C)(C)OC1'], ['CC1(CO1)C1CCC(C)(C)OC1'], 'via halohydrine') },
  { t: 'Lavendel · vraag 12', q: 'Geef het volledige mechanisme tot het hoofdproduct.', steps: toQ(['CC1(CO1)C1CCC(C)(C)OC1'], 'CH₃CH₂Br, Mg') },
  { t: 'Lavendel · vraag 18', q: 'Geef het mechanisme van de vorming van linalylacetaat (11b) uit (+)-linalool.', steps: toQ(['CC(C)=CCCC(C)(O)C=C', 'CC(=O)O'], 'reflux') },
  { t: 'Lavendel · vraag 19', q: 'Geef het volledige mechanisme van 11b naar 12b.', steps: given(['CC(C)=CCCC(C)(OC(C)=O)C=C'], ['CC(C)(O)C(Cl)CCC(C)(OC(C)=O)C=C'], 'HOCl/H₂O', 'CH₂Cl₂') },
  { t: 'Lavendel · vraag 22', q: 'Teken het mechanisme van de vorming van 14c uit 13c.', steps: toQ(['C=C(c1ccccc1)C(Cl)CCC(C)(OC(C)=O)C=C'], '(CH₃)₃CO⁻', 'tert-butanol') },
 ]},
 { title: 'Les 17 · Casustoets doorgronden', color: '#b45309', items: [
  { t: 'Prozac · vraag 1b', q: 'Geef het volledige mechanisme van 2 → 3 (in water; extra NaCl versnelt de reactie niet).', steps: given(['CN(C)CCC(O)c1ccccc1'], ['CN(C)CCC(Cl)c1ccccc1'], 'HCl', 'H₂O') },
  { t: 'Prozac · vraag 2e', q: 'Maak met het mechanisme duidelijk waarom Cl op C-1 komt en niet op C-2 van 8.', steps: given(['CN(C)C/C=C/c1ccccc1'], ['CN(C)CCC(Cl)c1ccccc1'], 'gec. HCl', 'H₂O') },
  { t: 'Betaxolol · vraag 1b', q: 'Geef het volledige mechanisme van de vorming van 4-vinylbenzyloxybenzeen (5).', steps: toQ(['C=Cc1ccc(O)cc1', 'BrCc1ccccc1'], 'KOH, FTK', 'THF') },
 ]},
]
