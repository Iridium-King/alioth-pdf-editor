# Run explicitly on the maintainer's computer, never during builds or CI.
# Keys stay non-exportable in the current user's Windows certificate store.
$ErrorActionPreference = 'Stop'
function Save-PrivateCertificate($certificate) {
    # Transfer only in memory to a persistent, non-exportable user key.
    $password = [Convert]::ToBase64String([System.Security.Cryptography.RandomNumberGenerator]::GetBytes(32))
    $bytes = $certificate.Export([System.Security.Cryptography.X509Certificates.X509ContentType]::Pfx,$password)
    try {
        $persisted = [System.Security.Cryptography.X509Certificates.X509Certificate2]::new($bytes,$password,
            [System.Security.Cryptography.X509Certificates.X509KeyStorageFlags]::UserKeySet -bor [System.Security.Cryptography.X509Certificates.X509KeyStorageFlags]::PersistKeySet)
        $store = [System.Security.Cryptography.X509Certificates.X509Store]::new('My','CurrentUser')
        try { $store.Open('ReadWrite'); $store.Add($persisted) } finally { $store.Dispose() }
        return $persisted
    } finally { [Array]::Clear($bytes,0,$bytes.Length); $password = $null }
}
$project = Split-Path $PSScriptRoot -Parent
$subject = 'CN=Alioth PDF Editor Local Root 2026'
$root = Get-ChildItem Cert:\CurrentUser\My | Where-Object {
    $_.Subject -eq $subject -and $_.HasPrivateKey
} | Select-Object -First 1
$maximum = [datetime]::new(9999, 12, 31, 23, 59, 59, [DateTimeKind]::Utc)
if (-not $root) {
    $rsa = [System.Security.Cryptography.RSA]::Create(4096)
    $request = [System.Security.Cryptography.X509Certificates.CertificateRequest]::new($subject, $rsa,
        [System.Security.Cryptography.HashAlgorithmName]::SHA256, [System.Security.Cryptography.RSASignaturePadding]::Pkcs1)
    $request.CertificateExtensions.Add([System.Security.Cryptography.X509Certificates.X509BasicConstraintsExtension]::new($true,$true,0,$true))
    $request.CertificateExtensions.Add([System.Security.Cryptography.X509Certificates.X509KeyUsageExtension]::new(
        [System.Security.Cryptography.X509Certificates.X509KeyUsageFlags]::KeyCertSign -bor [System.Security.Cryptography.X509Certificates.X509KeyUsageFlags]::CrlSign,$true))
    $oids = [System.Security.Cryptography.OidCollection]::new()
    $oids.Add([System.Security.Cryptography.Oid]::new('1.3.6.1.5.5.7.3.3')) | Out-Null
    $request.CertificateExtensions.Add([System.Security.Cryptography.X509Certificates.X509EnhancedKeyUsageExtension]::new($oids,$true))
    $created = $request.CreateSelfSigned([DateTimeOffset]::new((Get-Date).AddDays(-1)), [DateTimeOffset]::new($maximum))
    $root = Save-PrivateCertificate $created
    $created.Dispose(); $rsa.Dispose()
}
$signer = Get-ChildItem Cert:\CurrentUser\My | Where-Object {
    $_.Subject -eq 'CN=Alioth PDF Editor Local Signing' -and $_.Issuer -eq $root.Subject -and $_.HasPrivateKey
} | Select-Object -First 1
if (-not $signer) {
    $rsa = [System.Security.Cryptography.RSA]::Create(4096)
    $request = [System.Security.Cryptography.X509Certificates.CertificateRequest]::new('CN=Alioth PDF Editor Local Signing', $rsa,
        [System.Security.Cryptography.HashAlgorithmName]::SHA256, [System.Security.Cryptography.RSASignaturePadding]::Pkcs1)
    $request.CertificateExtensions.Add([System.Security.Cryptography.X509Certificates.X509BasicConstraintsExtension]::new($false,$false,0,$true))
    $request.CertificateExtensions.Add([System.Security.Cryptography.X509Certificates.X509KeyUsageExtension]::new(
        [System.Security.Cryptography.X509Certificates.X509KeyUsageFlags]::DigitalSignature,$true))
    $oids = [System.Security.Cryptography.OidCollection]::new()
    $oids.Add([System.Security.Cryptography.Oid]::new('1.3.6.1.5.5.7.3.3')) | Out-Null
    $request.CertificateExtensions.Add([System.Security.Cryptography.X509Certificates.X509EnhancedKeyUsageExtension]::new($oids,$true))
    $serial = [System.Security.Cryptography.RandomNumberGenerator]::GetBytes(16)
    $issued = $request.Create($root,[DateTimeOffset]::new((Get-Date).AddHours(-1)),[DateTimeOffset]::new($maximum),$serial)
    $created = [System.Security.Cryptography.X509Certificates.RSACertificateExtensions]::CopyWithPrivateKey($issued,$rsa)
    $signer = Save-PrivateCertificate $created
    $issued.Dispose(); $created.Dispose(); $rsa.Dispose()
}
$path = Join-Path $project 'Alioth-PDF-Local-Root.cer'
Export-Certificate -Cert $root -FilePath $path -Force | Out-Null
# Trust is applied by the app's existing current-user CryptoAPI integration.
[pscustomobject]@{Root=$root.Thumbprint; Signer=$signer.Thumbprint; NotAfter=$signer.NotAfter.ToUniversalTime().ToString('o'); PrivateKeyExport='NonExportable'} | ConvertTo-Json
