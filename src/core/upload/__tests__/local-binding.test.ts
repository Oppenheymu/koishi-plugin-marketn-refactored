import { describe, expect, it } from "vitest";
import {
    createHashedLocalBindingFilename,
    createLocalBindingRequest,
    MAX_LOCAL_BINDING_PACK_SIZE,
    parseNpmPackOutput,
} from "../local-binding.js";

describe("parseNpmPackOutput", () => {
    it("解析合法输出", () => {
        expect(
            parseNpmPackOutput(
                '[{"filename":"foo-1.0.0.tgz","size":1234,"name":"foo","version":"1.0.0"}]',
            ),
        ).toEqual({ name: "foo", version: "1.0.0", filename: "foo-1.0.0.tgz", size: 1234 });
    });

    it("非数组/空数组/非法 JSON 抛错", () => {
        expect(() => parseNpmPackOutput("{}")).toThrow("invalid npm pack output");
        expect(() => parseNpmPackOutput("[]")).toThrow("invalid npm pack output");
        expect(() => parseNpmPackOutput("not json")).toThrow("invalid npm pack output");
    });

    it("非法文件名抛错", () => {
        expect(() => parseNpmPackOutput('[{"filename":"../evil.tgz","size":1}]')).toThrow(
            "invalid npm pack filename",
        );
        expect(() => parseNpmPackOutput('[{"filename":"foo.tar","size":1}]')).toThrow(
            "invalid npm pack filename",
        );
        expect(() => parseNpmPackOutput('[{"filename":123,"size":1}]')).toThrow(
            "invalid npm pack filename",
        );
    });

    it("非法大小抛错", () => {
        expect(() => parseNpmPackOutput('[{"filename":"foo.tgz","size":0}]')).toThrow(
            "invalid npm pack size",
        );
        expect(() => parseNpmPackOutput('[{"filename":"foo.tgz","size":-1}]')).toThrow(
            "invalid npm pack size",
        );
        expect(() => parseNpmPackOutput('[{"filename":"foo.tgz","size":1.5}]')).toThrow(
            "invalid npm pack size",
        );
        const tooBig = `[{"filename":"foo.tgz","size":${String(MAX_LOCAL_BINDING_PACK_SIZE + 1)}}]`;
        expect(() => parseNpmPackOutput(tooBig)).toThrow("invalid npm pack size");
    });
});

describe("createLocalBindingRequest", () => {
    it("生成 file:.yarn/local 请求", () => {
        expect(createLocalBindingRequest("foo-1.0.0.tgz")).toBe("file:.yarn/local/foo-1.0.0.tgz");
    });

    it("非法文件名抛错", () => {
        expect(() => createLocalBindingRequest("a/b.tgz")).toThrow("invalid npm pack filename");
    });
});

describe("createHashedLocalBindingFilename", () => {
    it("注入内容 hash 前缀", () => {
        expect(createHashedLocalBindingFilename("foo-1.0.0.tgz", "ABCDEFabcdef123456789012")).toBe(
            "foo-1.0.0-abcdefabcdef123456789012.tgz",
        );
    });

    it("hash 过短或非法抛错", () => {
        expect(() => createHashedLocalBindingFilename("foo.tgz", "abc")).toThrow(
            "invalid npm pack hash",
        );
        expect(() => createHashedLocalBindingFilename("foo.tgz", "zzzzzzzzzzzz")).toThrow(
            "invalid npm pack hash",
        );
    });
});
