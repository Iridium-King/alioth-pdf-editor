param(
    [string]$ReleasePath = (Join-Path $PSScriptRoot 'RELEASE'),
    [ValidateSet('Distribucion','Personal','both','host')][string]$Edition = 'Distribucion'
)

$ErrorActionPreference = 'Stop'
$rootFile = Join-Path $PSScriptRoot 'Alioth-PDF-Local-Root.cer'
$root = [System.Security.Cryptography.X509Certificates.X509Certificate2]::new($rootFile)
$trusted = Get-Item -LiteralPath ("Cert:\CurrentUser\Root\{0}" -f $root.Thumbprint) -ErrorAction SilentlyContinue
if (-not $trusted) { throw 'La raíz local incluida no está instalada para validar la firma.' }

$signer = Get-ChildItem Cert:\CurrentUser\My | Where-Object {
    $_.Subject -eq 'CN=Alioth PDF Editor Local Signing' -and $_.Issuer -eq $root.Subject -and
    $_.HasPrivateKey -and $_.NotAfter -gt (Get-Date)
} | Select-Object -First 1
if (-not $signer) { throw 'No se encontró el certificado de firma existente.' }

$paths = @()
if ($Edition -eq 'host') {
    $paths += Join-Path $PSScriptRoot 'native_host/bin/AliothPDFHost.exe'
} else {
    $packages = if ($Edition -eq 'both') { @('Personal','Distribucion') } else { @($Edition) }
    foreach ($package in $packages) { $paths += Join-Path (Join-Path $ReleasePath $package) "Alioth_PDF_Editor_$package.exe" }
}
foreach ($exePath in $paths) {
    if (-not (Test-Path -LiteralPath $exePath)) { throw "Falta $exePath" }
    $signed = Set-AuthenticodeSignature -LiteralPath $exePath -Certificate $signer -HashAlgorithm SHA256
    if ($signed.Status -ne 'Valid') { throw "La firma no fue válida: $exePath ($($signed.Status))" }
    $verified = Get-AuthenticodeSignature -LiteralPath $exePath
    if ($verified.Status -ne 'Valid' -or $verified.SignerCertificate.Thumbprint -ne $signer.Thumbprint) {
        throw "No se pudo verificar la firma: $exePath"
    }
    Write-Host "Firma válida: $exePath"
}
