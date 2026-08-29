from pypdf import PdfReader
r = PdfReader(r'C:/edu4bharat/raw/tnpsc/group-1/question-papers/2019/04_03_2019_G1P_GS.pdf')
print('Pages:', len(r.pages))
