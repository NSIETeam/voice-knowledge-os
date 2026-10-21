// Test-only fetcher using macOS system trust, like the shipped FluidAudio loader.
// Never override server trust or send cookies/credentials to a public mirror.
import Foundation

final class HTTPSOnly: NSObject, URLSessionTaskDelegate {
    func urlSession(_ session: URLSession, task: URLSessionTask,
                    willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest,
                    completionHandler: @escaping (URLRequest?) -> Void) {
        completionHandler(request.url?.scheme == "https" ? request : nil)
    }
}

enum FetchError: Error { case invalidResponse, wrongSize }
let args = CommandLine.arguments
guard args.count == 4, let url = URL(string: args[1]), url.scheme == "https",
      url.user == nil, url.password == nil,
      args[2].hasPrefix("/"), let expectedSize = Int(args[3]),
      expectedSize > 0, expectedSize <= 1_000_000 else {
    fputs("usage: fetch-public-fixture <https-url> <absolute-new-file> <expected-bytes>\n", stderr)
    exit(2)
}
let configuration = URLSessionConfiguration.ephemeral
configuration.timeoutIntervalForRequest = 15
configuration.timeoutIntervalForResource = 45
configuration.httpShouldSetCookies = false
configuration.httpCookieStorage = nil
configuration.urlCredentialStorage = nil
configuration.urlCache = nil
let session = URLSession(configuration: configuration, delegate: HTTPSOnly(), delegateQueue: nil)
let semaphore = DispatchSemaphore(value: 0)
var exitCode: Int32 = 1
Task {
    do {
        let (bytes, response) = try await session.bytes(from: url)
        guard let http = response as? HTTPURLResponse, http.statusCode == 200,
              response.url?.scheme == "https",
              response.expectedContentLength < 0 || response.expectedContentLength == expectedSize else {
            throw FetchError.invalidResponse
        }
        var data = Data()
        data.reserveCapacity(expectedSize)
        for try await byte in bytes {
            guard data.count < expectedSize else { throw FetchError.wrongSize }
            data.append(byte)
        }
        guard data.count == expectedSize else { throw FetchError.wrongSize }
        try data.write(to: URL(fileURLWithPath: args[2]), options: .withoutOverwriting)
        exitCode = 0
    } catch {
        fputs("public fixture fetch failed: \(error.localizedDescription)\n", stderr)
    }
    session.invalidateAndCancel()
    semaphore.signal()
}
if semaphore.wait(timeout: .now() + 50) == .timedOut {
    session.invalidateAndCancel()
    fputs("public fixture fetch timed out\n", stderr)
    exit(1)
}
exit(exitCode)
