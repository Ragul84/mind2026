import fitz, sys
doc = fitz.open('tmp-pyq/tnpsc/2019-group1-key.pdf')
print(f'Pages: {len(doc)}')
for i, page in enumerate(doc):
    text = page.get_text()
    print(f'--- Page {i+1} ({len(text)} chars) ---')
    print(text[:500])
    print()
