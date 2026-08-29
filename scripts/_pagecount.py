import subprocess
result = subprocess.run(
    [r'C:/Program Files/gs/gs10.07.1/bin/gswin64c.exe', '-q', '-dNOPAUSE', '-dBATCH', '-sDEVICE=nullpage', r'C:/edu4bharat/raw/tnpsc/group-1/question-papers/2019/04_03_2019_G1P_GS.pdf'],
    capture_output=True, text=True
)
print('stderr:', result.stderr[:800])
print('stdout:', result.stdout[:800])
